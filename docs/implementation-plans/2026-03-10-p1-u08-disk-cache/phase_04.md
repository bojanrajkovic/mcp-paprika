# DiskCache Implementation Plan — Phase 4: Diff Methods

**Goal:** Add `diffRecipes()`, `diffCategories()`, and the shared private `_diffEntries()` algorithm to `DiskCache`. These synchronous methods compare the Paprika remote listing against the local index to classify changes as `added`, `changed`, or `removed` without reading full recipe files.

**Architecture:** `_diffEntries()` is a pure synchronous helper that takes a remote listing and the relevant section of `_index` (a `Record<string, string>` of uid → hash). It builds a `Set<string>` of remote UIDs for O(1) lookup, iterates remote entries to find `added`/`changed`, then scans local keys to find `removed`. Both public diff methods assert `_index !== null` before delegating to `_diffEntries()`.

**Tech Stack:** TypeScript 5.9, ES2015 `Set`, no external libraries

**Scope:** Phase 4 of 5 from the original design

**Codebase verified:** 2026-03-10

---

## Acceptance Criteria Coverage

### p1-u08-disk-cache.AC5: Diff methods

- **p1-u08-disk-cache.AC5.1 Success:** `diffRecipes()` returns UIDs present in remote but not local index as `added`
- **p1-u08-disk-cache.AC5.2 Success:** `diffRecipes()` returns UIDs where remote hash differs from local index as `changed`
- **p1-u08-disk-cache.AC5.3 Success:** `diffRecipes()` returns UIDs in local index but not in remote as `removed`
- **p1-u08-disk-cache.AC5.4 Edge:** `diffRecipes()` with empty remote and populated index returns all local UIDs as `removed`
- **p1-u08-disk-cache.AC5.5 Edge:** `diffRecipes()` with empty remote and empty index returns `{ added: [], changed: [], removed: [] }`
- **p1-u08-disk-cache.AC5.6 Success:** `diffCategories()` applies the same algorithm to `_index.categories`
- **p1-u08-disk-cache.AC5.7 Failure:** `diffRecipes()` throws if called before `init()`
- **p1-u08-disk-cache.AC5.8 Failure:** `diffCategories()` throws if called before `init()`

### p1-u08-disk-cache.AC6: Index consistency (completion)

- **p1-u08-disk-cache.AC6.1 Success:** `putRecipe()` updates `_index.recipes[uid]` in memory immediately — a subsequent `diffRecipes()` reflects the new hash without calling `flush()`

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Add diff methods to `src/cache/disk-cache.ts`

**Verifies:** p1-u08-disk-cache.AC5.1–AC5.8, p1-u08-disk-cache.AC6.1

**Files:**

- Modify: `src/cache/disk-cache.ts`

**Implementation:**

First, update the import from `../paprika/types.js` to add `RecipeEntry`, `CategoryEntry`, and `DiffResult` — these types already exist in `types.ts` and are used as parameter and return types for the diff methods:

```typescript
import { RecipeStoredSchema, CategoryStoredSchema } from "../paprika/types.js";
import type { Recipe, Category, RecipeEntry, CategoryEntry, DiffResult } from "../paprika/types.js";
```

Then add the following three methods to the `DiskCache` class, after `putCategory()`:

```typescript
  // Private synchronous helper. Classifies remote entries against the local
  // uid → hash map into added/changed/removed. Uses a Set for O(1) remote
  // UID lookup so the algorithm is O(n + m), not O(n × m).
  private _diffEntries(
    remote: ReadonlyArray<{ readonly uid: string; readonly hash: string }>,
    local: Readonly<Record<string, string>>,
  ): DiffResult {
    const added: Array<string> = [];
    const changed: Array<string> = [];
    const remoteUids = new Set<string>();

    for (const entry of remote) {
      remoteUids.add(entry.uid);
      // noUncheckedIndexedAccess: local[uid] is string | undefined
      const localHash = local[entry.uid];
      if (localHash === undefined) {
        added.push(entry.uid);
      } else if (localHash !== entry.hash) {
        changed.push(entry.uid);
      }
    }

    const removed = Object.keys(local).filter((uid) => !remoteUids.has(uid));

    return { added, changed, removed };
  }

  diffRecipes(entries: ReadonlyArray<RecipeEntry>): DiffResult {
    if (this._index === null) {
      throw new Error("DiskCache: diffRecipes() called before init()");
    }
    return this._diffEntries(entries, this._index.recipes);
  }

  diffCategories(entries: ReadonlyArray<CategoryEntry>): DiffResult {
    if (this._index === null) {
      throw new Error("DiskCache: diffCategories() called before init()");
    }
    return this._diffEntries(entries, this._index.categories);
  }
```

**Note on types:** `RecipeEntry` has `uid: RecipeUid` (branded string). `RecipeUid` is a subtype of `string`, so `RecipeEntry` is assignable to `{ uid: string; hash: string }`. The `_diffEntries` signature accepts both.

**Step 1: Update the import and add the three methods**

Follow the implementation above.

**Step 2: Verify type-check**

```bash
pnpm typecheck
```

Expected: Zero errors.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Add diff tests to `src/cache/disk-cache.test.ts`

**Verifies:** p1-u08-disk-cache.AC5.1–AC5.8, p1-u08-disk-cache.AC6.1

**Files:**

- Modify: `src/cache/disk-cache.test.ts`

**Testing:**

Import `makeRecipe` and `makeCategory` from `./__fixtures__/recipes.js` (already imported from Phase 3 tests). Add a new `describe('diffRecipes / diffCategories')` block inside the existing `describe('DiskCache')` block. Each test creates a fresh `new DiskCache(tempDir)` and calls `await cache.init()`.

Use `putRecipe(recipe, hash)` to populate `_index` in memory before calling `diffRecipes()`. No `flush()` is needed for diff tests — the diff methods operate purely on `_index` which is updated in memory by `putRecipe()`.

**AC5 tests:**

- **p1-u08-disk-cache.AC5.1 (added):** `init()` a fresh cache (empty local index). Create `const recipe = makeRecipe({ uid: 'uid-1' as RecipeUid })`. Call `diffRecipes([{ uid: recipe.uid, hash: 'h1' }])`. Assert `result.added` contains `recipe.uid`; `result.changed` and `result.removed` are empty.

- **p1-u08-disk-cache.AC5.2 (changed):** Create `const recipe = makeRecipe({ uid: 'uid-1' as RecipeUid })`. Call `putRecipe(recipe, 'hash-v1')` to load `recipe.uid` into local index. Call `diffRecipes([{ uid: recipe.uid, hash: 'hash-v2' }])`. Assert `result.changed` contains `recipe.uid`; `added` and `removed` are empty.

- **p1-u08-disk-cache.AC5.3 (removed):** Create `const recipe = makeRecipe({ uid: 'uid-1' as RecipeUid })`. Call `putRecipe(recipe, 'hash-v1')` to put it in local index. Call `diffRecipes([])` (empty remote). Assert `result.removed` contains `recipe.uid`; `added` and `changed` are empty.

- **p1-u08-disk-cache.AC5.4 (empty remote, populated index):** Create 3 recipes with `makeRecipe({ uid: 'uid-1' as RecipeUid })`, `makeRecipe({ uid: 'uid-2' as RecipeUid })`, `makeRecipe({ uid: 'uid-3' as RecipeUid })`. `putRecipe` each with a hash. Call `diffRecipes([])`. Assert `result.removed` has length 3 and contains all 3 UIDs.

- **p1-u08-disk-cache.AC5.5 (empty remote and empty index):** Call `diffRecipes([])` on a fresh empty cache. Assert result is `{ added: [], changed: [], removed: [] }`.

- **p1-u08-disk-cache.AC5.6 (diffCategories):** `putCategory(category, 'hash-c1')`. Call `diffCategories([{ uid: category.uid, hash: 'hash-c2' }])`. Assert `result.changed` contains `category.uid`. Then call `diffCategories([])`. Assert `result.removed` contains `category.uid`.

- **p1-u08-disk-cache.AC5.7 (throws before init — recipes):** Create `new DiskCache(tempDir)` without `init()`. Assert `cache.diffRecipes([])` throws.

- **p1-u08-disk-cache.AC5.8 (throws before init — categories):** Create `new DiskCache(tempDir)` without `init()`. Assert `cache.diffCategories([])` throws.

**AC6.1 test:**

- **p1-u08-disk-cache.AC6.1:** `init()`. Call `putRecipe(recipe, 'hash-v1')`. Call `diffRecipes([{ uid: recipe.uid, hash: 'hash-v1' }])`. Assert the result has no `added`, no `changed`, no `removed` (local and remote hashes match — no flush needed). Then call `putRecipe(recipe, 'hash-v2')` (same uid, new hash). Call `diffRecipes([{ uid: recipe.uid, hash: 'hash-v1' }])`. Assert `result.changed` contains `recipe.uid` (local index now has `hash-v2`, remote has `hash-v1` → changed).

**Mixed scenario test (added, changed, removed in one call):**

- Create 3 recipes: `r1 = makeRecipe({ uid: 'uid-1' as RecipeUid })`, `r2 = makeRecipe({ uid: 'uid-2' as RecipeUid })`, `r3 = makeRecipe({ uid: 'uid-3' as RecipeUid })`. Call `putRecipe(r1, 'hash-a')`, `putRecipe(r2, 'hash-b')`, `putRecipe(r3, 'hash-c')`. Call `diffRecipes([{ uid: r1.uid, hash: 'hash-a' }, { uid: r2.uid, hash: 'hash-CHANGED' }, { uid: 'uid-4' as RecipeUid, hash: 'hash-new' }])`. Assert: `result.added` contains `'uid-4'`, `result.changed` contains `r2.uid`, `result.removed` contains `r3.uid`.

**Verification:**

```bash
pnpm test -- src/cache/disk-cache.test.ts
```

Expected: All tests pass (Phase 2 + Phase 3 + Phase 4 tests).

**Step 1: Add the diff tests**

Write all tests described above in the `src/cache/disk-cache.test.ts` file.

**Step 2: Run tests**

```bash
pnpm test -- src/cache/disk-cache.test.ts
```

Expected: All tests pass.

**Step 3: Run full suite**

```bash
pnpm test
```

Expected: All tests pass with no regressions.

**Step 4: Commit**

```bash
git add src/cache/disk-cache.ts src/cache/disk-cache.test.ts
git commit -m "feat(cache): add DiskCache diff methods — AC5, AC6.1"
```

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
