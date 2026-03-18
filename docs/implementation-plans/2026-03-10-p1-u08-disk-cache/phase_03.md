# DiskCache Implementation Plan — Phase 3: Recipe and Category CRUD

**Goal:** Add `getRecipe`, `putRecipe`, `removeRecipe`, `getAllRecipes`, `getCategory`, and `putCategory` methods to `DiskCache`. All disk reads are validated with `RecipeStoredSchema` / `CategoryStoredSchema`. Pending maps (from Phase 2) are read first by `get*()` methods, so callers can read back data they just put in the same sync cycle.

**Architecture:** All `put*()` methods write to the in-memory pending map and update `_index` in memory only — no file I/O. `get*()` checks the pending map first, then reads and validates from disk. `removeRecipe()` deletes the file if present (idempotent), removes from `_index`, and clears from the pending map. `getAllRecipes()` merges the pending map with all `.json` files in `recipesDir`, with pending entries shadowing disk entries for the same UID.

**Tech Stack:** TypeScript 5.9, Node.js `node:fs/promises` (readFile, readdir, unlink), Zod (`RecipeStoredSchema`, `CategoryStoredSchema`)

**Scope:** Phase 3 of 5 from the original design

**Codebase verified:** 2026-03-10

---

## Acceptance Criteria Coverage

### p1-u08-disk-cache.AC3: Recipe CRUD

- **p1-u08-disk-cache.AC3.1 Success:** `putRecipe(recipe, hash)` does not write any file — `recipes/{uid}.json` is absent until `flush()` is called
- **p1-u08-disk-cache.AC3.2 Success:** `getRecipe(uid)` returns the buffered recipe immediately after `putRecipe()`, before `flush()`
- **p1-u08-disk-cache.AC3.3 Success:** After `putRecipe()` + `flush()`, `getRecipe(uid)` returns the same recipe (round-trip, Zod-validated)
- **p1-u08-disk-cache.AC3.4 Success:** `getRecipe(uid)` returns `null` for a UID that was never put
- **p1-u08-disk-cache.AC3.5 Success:** `removeRecipe(uid)` deletes the file (if present), removes the UID from `_index.recipes`, and clears it from the pending map
- **p1-u08-disk-cache.AC3.6 Edge:** `removeRecipe(uid)` does not throw if the file does not exist (idempotent)
- **p1-u08-disk-cache.AC3.7 Success:** `getAllRecipes()` includes pending (not-yet-flushed) recipes
- **p1-u08-disk-cache.AC3.8 Success:** `getAllRecipes()` returns all flushed `.json` files from `recipesDir` as validated `Recipe` objects
- **p1-u08-disk-cache.AC3.9 Edge:** `getAllRecipes()` returns `[]` when `recipesDir` is empty or does not exist

### p1-u08-disk-cache.AC4: Category CRUD

- **p1-u08-disk-cache.AC4.1 Success:** `putCategory()` does not write any file until `flush()` is called
- **p1-u08-disk-cache.AC4.2 Success:** `getCategory(uid)` returns the buffered category before `flush()`
- **p1-u08-disk-cache.AC4.3 Success:** After `putCategory()` + `flush()`, `getCategory(uid)` returns the same category (round-trip, Zod-validated)
- **p1-u08-disk-cache.AC4.4 Success:** `getCategory(uid)` returns `null` for a UID that was never put

### p1-u08-disk-cache.AC6: Index consistency

- **p1-u08-disk-cache.AC6.2 Success:** After `putRecipe(recipe, hash)` + `flush()`, `index.json` contains `recipes[uid] = hash`
- **p1-u08-disk-cache.AC6.3 Success:** After `removeRecipe(uid)` + `flush()`, `index.json` does not contain the removed UID
- **p1-u08-disk-cache.AC6.4 Edge:** `putRecipe()` called without `flush()` leaves `index.json` absent (or unchanged from the last flush)

### p1-u08-disk-cache.AC2: Atomic fsynced flush (completion)

- **p1-u08-disk-cache.AC2.2 Success:** After `flush()`, pending recipe and category files exist in their respective subdirectories

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Add CRUD methods to `src/cache/disk-cache.ts`

**Verifies:** p1-u08-disk-cache.AC3.1–AC3.9, p1-u08-disk-cache.AC4.1–AC4.4, p1-u08-disk-cache.AC6.2–AC6.4, p1-u08-disk-cache.AC2.2

**Files:**

- Modify: `src/cache/disk-cache.ts`

**Implementation:**

First, update the import line at the top of the file. Add `readdir` and `unlink` to the `node:fs/promises` import, and add `RecipeStoredSchema` and `CategoryStoredSchema` to the types import:

```typescript
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { RecipeStoredSchema, CategoryStoredSchema } from "../paprika/types.js";
import type { Recipe, Category } from "../paprika/types.js";
```

Then add the following six methods to the `DiskCache` class, after the `flush()` method:

```typescript
  async getRecipe(uid: string): Promise<Recipe | null> {
    // Pending map is checked first so callers can read back data they just
    // put in the same sync cycle (before flush writes it to disk).
    const pending = this._pendingRecipes.get(uid);
    if (pending !== undefined) {
      return pending;
    }

    const filePath = join(this._recipesDir, `${uid}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    return RecipeStoredSchema.parse(JSON.parse(raw));
  }

  async putRecipe(recipe: Recipe, hash: string): Promise<void> {
    if (this._index === null) {
      throw new Error("DiskCache: putRecipe() called before init()");
    }
    // Buffer in memory only — no file I/O. flush() writes to disk.
    this._pendingRecipes.set(recipe.uid, recipe);
    // Update index immediately so diffRecipes() reflects the new hash
    // without requiring flush() first (AC6.1).
    this._index.recipes[recipe.uid] = hash;
  }

  async removeRecipe(uid: string): Promise<void> {
    // Delete file from disk if present. ENOENT is fine — idempotent.
    const filePath = join(this._recipesDir, `${uid}.json`);
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    // Remove from index and pending map.
    if (this._index === null) {
      throw new Error("DiskCache: removeRecipe() called before init()");
    }
    delete this._index.recipes[uid];
    this._pendingRecipes.delete(uid);
  }

  async getAllRecipes(): Promise<Array<Recipe>> {
    // Start with pending entries. Pending shadows disk for the same UID.
    const result: Map<string, Recipe> = new Map(this._pendingRecipes);

    // Read all .json files from recipesDir and add those not already in pending.
    let files: Array<string>;
    try {
      files = await readdir(this._recipesDir);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [...result.values()];
      }
      throw error;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    await Promise.all(
      jsonFiles.map(async (filename) => {
        const uid = filename.slice(0, -5); // strip ".json"
        if (result.has(uid)) return; // pending entry shadows disk
        const raw = await readFile(join(this._recipesDir, filename), "utf-8");
        const recipe = RecipeStoredSchema.parse(JSON.parse(raw));
        result.set(uid, recipe);
      }),
    );

    return [...result.values()];
  }

  async getCategory(uid: string): Promise<Category | null> {
    const pending = this._pendingCategories.get(uid);
    if (pending !== undefined) {
      return pending;
    }

    const filePath = join(this._categoriesDir, `${uid}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    return CategoryStoredSchema.parse(JSON.parse(raw));
  }

  async putCategory(category: Category, hash: string): Promise<void> {
    if (this._index === null) {
      throw new Error("DiskCache: putCategory() called before init()");
    }
    this._pendingCategories.set(category.uid, category);
    this._index.categories[category.uid] = hash;
  }
```

**Note on `delete this._index.recipes[uid]`:** `Record<string, string>` is an index signature type and TypeScript allows `delete` on index signature members. If `pnpm typecheck` rejects this, use the safe alternative:

```typescript
const { [uid]: _removed, ...remaining } = this._index.recipes;
void _removed;
this._index.recipes = remaining;
```

**Step 1: Update imports and add the six methods**

Follow the implementation above. The six methods go after `flush()` in the class body.

**Step 2: Verify type-check**

```bash
pnpm typecheck
```

Expected: Zero errors.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Add CRUD tests to `src/cache/disk-cache.test.ts`

**Verifies:** p1-u08-disk-cache.AC3.1–AC3.9, p1-u08-disk-cache.AC4.1–AC4.4, p1-u08-disk-cache.AC6.2–AC6.4, p1-u08-disk-cache.AC2.2

**Files:**

- Modify: `src/cache/disk-cache.test.ts`
- Reference fixture: `src/cache/__fixtures__/recipes.ts` (import `makeRecipe`, `makeCategory`)

**Testing:**

Import `makeRecipe` and `makeCategory` from `./__fixtures__/recipes.js`. Add the following test cases to the existing `describe('DiskCache')` block. Each test uses the `tempDir` from the existing `beforeEach`/`afterEach` setup.

For each test that calls `init()` before CRUD methods: create a fresh `new DiskCache(tempDir)` and `await cache.init()` at the start of the test.

**AC3 tests:**

- **p1-u08-disk-cache.AC3.1:** Call `putRecipe(recipe, hash)`. Assert `stat(join(tempDir, 'recipes', recipe.uid + '.json'))` rejects (file does not exist yet). No `flush()` called.

- **p1-u08-disk-cache.AC3.2:** Call `putRecipe(recipe, hash)` then `getRecipe(recipe.uid)` without `flush()`. Assert the returned recipe deep-equals the one that was put.

- **p1-u08-disk-cache.AC3.3:** Call `putRecipe(recipe, hash)`, then `flush()`, then `getRecipe(recipe.uid)`. Assert the returned recipe deep-equals the original recipe. (This tests the full round-trip including Zod validation of the persisted JSON.)

- **p1-u08-disk-cache.AC3.4:** Call `getRecipe('nonexistent-uid')`. Assert the result is `null`.

- **p1-u08-disk-cache.AC3.5:** Call `putRecipe(recipe, hash)`, `flush()` (writes the file to disk), then `removeRecipe(recipe.uid)`. Assert:
  - `stat(join(tempDir, 'recipes', recipe.uid + '.json'))` rejects (file deleted)
  - `getRecipe(recipe.uid)` returns `null` (removed from pending and disk)

- **p1-u08-disk-cache.AC3.6:** Call `removeRecipe('uid-that-was-never-put')`. Assert this resolves without throwing.

- **p1-u08-disk-cache.AC3.7:** Call `putRecipe(recipe, hash)` without `flush()`. Call `getAllRecipes()`. Assert the result array contains the pending recipe.

- **p1-u08-disk-cache.AC3.8:** Create 3 recipes. `putRecipe` each + `flush()`. Create a new `DiskCache(tempDir)`, `init()` (loads from disk), `getAllRecipes()`. Assert 3 recipes are returned and each deep-equals the original.

- **p1-u08-disk-cache.AC3.9 (empty dir):** Call `getAllRecipes()` on a fresh cache (no recipes put). Assert result is `[]`.
  Also test the ENOENT case: manually delete the `recipes/` subdirectory after `init()` (use `rm(join(tempDir, 'recipes'), { recursive: true })`), then call `getAllRecipes()`. Assert result is `[]`.

**AC4 tests:**

- **p1-u08-disk-cache.AC4.1:** Call `putCategory(category, hash)`. Assert `stat(join(tempDir, 'categories', category.uid + '.json'))` rejects. No `flush()`.

- **p1-u08-disk-cache.AC4.2:** Call `putCategory(category, hash)` then `getCategory(category.uid)` without `flush()`. Assert result deep-equals the original category.

- **p1-u08-disk-cache.AC4.3:** Call `putCategory(category, hash)`, `flush()`, then `getCategory(category.uid)`. Assert result deep-equals the original category (round-trip via Zod validation).

- **p1-u08-disk-cache.AC4.4:** Call `getCategory('nonexistent-uid')`. Assert result is `null`.

**AC6 index consistency tests:**

- **p1-u08-disk-cache.AC6.2:** Call `putRecipe(recipe, 'my-hash')`, then `flush()`. Read `index.json` from disk, parse it, and assert `parsedIndex.recipes[recipe.uid] === 'my-hash'`.

- **p1-u08-disk-cache.AC6.3:** Call `putRecipe(recipe, hash)`, `flush()` (writes recipe and index), then `removeRecipe(recipe.uid)`, `flush()` again. Read `index.json` and assert `recipe.uid` is not a key in `parsedIndex.recipes`.

- **p1-u08-disk-cache.AC6.4:** Call `putRecipe(recipe, hash)` but do NOT call `flush()`. Assert `stat(join(tempDir, 'index.json'))` rejects (index.json does not exist because flush was never called on a fresh cache).

**AC2.2 completion test:**

- **p1-u08-disk-cache.AC2.2:** Call `putRecipe(recipe, hash)`, `putCategory(category, catHash)`, then `flush()`. Assert:
  - `stat(join(tempDir, 'recipes', recipe.uid + '.json'))` resolves (file exists)
  - `stat(join(tempDir, 'categories', category.uid + '.json'))` resolves (file exists)

**Verification:**

```bash
pnpm test -- src/cache/disk-cache.test.ts
```

Expected: All tests pass (Phase 2 tests + Phase 3 tests).

```bash
pnpm test
```

Expected: Full suite passes with no regressions.

**Step 1: Update the test file**

Add the CRUD tests described above to the existing `describe('DiskCache')` block in `src/cache/disk-cache.test.ts`.

**Step 2: Run only the disk-cache tests first**

```bash
pnpm test -- src/cache/disk-cache.test.ts
```

Expected: All tests pass.

**Step 3: Run full suite**

```bash
pnpm test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/cache/disk-cache.ts src/cache/disk-cache.test.ts
git commit -m "feat(cache): add DiskCache CRUD methods — AC2.2, AC3, AC4, AC6.2-6.4"
```

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
