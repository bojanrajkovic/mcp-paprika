# DiskCache Implementation Plan — Phase 2: Skeleton, `init()`, and `flush()`

**Goal:** Create `src/cache/disk-cache.ts` with the `DiskCache` class constructor, `init()`, and `flush()`. Establish directory layout, index loading/recovery, and atomic fsynced batch writes.

**Architecture:** `DiskCache` is the imperative shell for all cache I/O. `init()` creates subdirectories and loads or recovers `index.json` via `CacheIndexSchema.safeParse()`. `flush()` writes all pending files fsynced via Node.js `FileHandle`, then commits the index atomically via temp-then-rename. Both `_pendingRecipes` and `_pendingCategories` are private Maps initialized here (populated by Phase 3 CRUD methods).

**Tech Stack:** TypeScript 5.9, Node.js `node:fs/promises` (FileHandle, mkdir, rename), Zod (CacheIndexSchema)

**Scope:** Phase 2 of 5 from the original design

**Codebase verified:** 2026-03-10

---

## Acceptance Criteria Coverage

### p1-u08-disk-cache.AC1: Directory initialisation and index loading

- **p1-u08-disk-cache.AC1.1 Success:** `init()` creates `recipes/` and `categories/` subdirectories under `cacheDir`
- **p1-u08-disk-cache.AC1.2 Success:** `init()` loads a valid `index.json` into `_index` when it exists
- **p1-u08-disk-cache.AC1.3 Success:** `init()` creates an empty index `{ recipes: {}, categories: {} }` when `index.json` does not exist (ENOENT = first run)
- **p1-u08-disk-cache.AC1.4 Success:** `init()` resets to empty index and calls `log()` when `index.json` is present but fails `CacheIndexSchema` validation
- **p1-u08-disk-cache.AC1.5 Failure:** `init()` rethrows non-ENOENT I/O errors (e.g. permission denied)

### p1-u08-disk-cache.AC2: Atomic fsynced flush

- **p1-u08-disk-cache.AC2.1 Success:** After `flush()`, `index.json` exists in `cacheDir` and contains valid JSON
- **p1-u08-disk-cache.AC2.3 Edge:** No `.tmp` file remains in `cacheDir` after a successful `flush()`
- **p1-u08-disk-cache.AC2.4 Failure:** `flush()` throws if called before `init()`

**Note:** AC2.2 (pending recipe and category files exist after flush) is tested in Phase 3, where `putRecipe()` and `putCategory()` are implemented and can populate the pending maps.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Create `src/cache/disk-cache.ts` — skeleton, `init()`, `flush()`

**Verifies:** p1-u08-disk-cache.AC1.1, p1-u08-disk-cache.AC1.2, p1-u08-disk-cache.AC1.3, p1-u08-disk-cache.AC1.4, p1-u08-disk-cache.AC1.5, p1-u08-disk-cache.AC2.1, p1-u08-disk-cache.AC2.3, p1-u08-disk-cache.AC2.4

**Files:**

- Create: `src/cache/disk-cache.ts`

**Implementation:**

Create the file with the following complete implementation. The file is the imperative shell for all cache persistence — it owns all `fs/promises` I/O and contains no business logic.

```typescript
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Recipe, Category } from "../paprika/types.js";

// Type guard for NodeJS.ErrnoException. Mirrors the local helper in
// utils/config.ts but is intentionally not exported from there — each
// module defines its own copy per the existing pattern.
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

// File-local schema for index.json. Not exported — internal to DiskCache.
const CacheIndexSchema = z.object({
  recipes: z.record(z.string(), z.string()),
  categories: z.record(z.string(), z.string()),
});

type CacheIndex = z.infer<typeof CacheIndexSchema>;

export class DiskCache {
  private readonly _cacheDir: string;
  private readonly _indexPath: string;
  private readonly _recipesDir: string;
  private readonly _categoriesDir: string;
  private readonly _log: (msg: string) => void;

  // Null until init() is called. diff*() and flush() assert non-null.
  private _index: CacheIndex | null = null;

  // Pending writes buffered by put*(). Drained by flush(). get*() checks
  // these maps before falling back to disk so callers can read back data
  // they just put in the same sync cycle.
  private readonly _pendingRecipes: Map<string, Recipe> = new Map();
  private readonly _pendingCategories: Map<string, Category> = new Map();

  constructor(cacheDir: string, log?: (msg: string) => void) {
    this._cacheDir = cacheDir;
    this._indexPath = join(cacheDir, "index.json");
    this._recipesDir = join(cacheDir, "recipes");
    this._categoriesDir = join(cacheDir, "categories");
    this._log = log ?? (() => undefined);
  }

  async init(): Promise<void> {
    // Create subdirectories (idempotent — recursive: true).
    await mkdir(this._recipesDir, { recursive: true });
    await mkdir(this._categoriesDir, { recursive: true });

    // Load index.json. ENOENT = first run → empty index.
    // Parse failure = corruption → log warning + empty index.
    // Other I/O error → rethrow.
    let raw: string;
    try {
      raw = await readFile(this._indexPath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this._index = { recipes: {}, categories: {} };
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this._log("DiskCache: corrupt index.json (invalid JSON), resetting to empty index");
      this._index = { recipes: {}, categories: {} };
      return;
    }

    const result = CacheIndexSchema.safeParse(parsed);
    if (!result.success) {
      this._log("DiskCache: corrupt index.json (schema mismatch), resetting to empty index");
      this._index = { recipes: {}, categories: {} };
      return;
    }

    this._index = result.data;
  }

  async flush(): Promise<void> {
    if (this._index === null) {
      throw new Error("DiskCache: flush() called before init()");
    }

    // Write all pending recipe and category files in parallel.
    // Each file is opened, written, fsynced, and closed before the index
    // rename — guaranteeing that if a crash occurs after the rename, all
    // referenced files are durably on disk.
    await Promise.all([
      ...[...this._pendingRecipes.entries()].map(async ([uid, recipe]) => {
        const filePath = join(this._recipesDir, `${uid}.json`);
        const fh = await open(filePath, "w");
        try {
          await fh.writeFile(JSON.stringify(recipe, null, 2));
          await fh.sync();
        } finally {
          await fh.close();
        }
      }),
      ...[...this._pendingCategories.entries()].map(async ([uid, category]) => {
        const filePath = join(this._categoriesDir, `${uid}.json`);
        const fh = await open(filePath, "w");
        try {
          await fh.writeFile(JSON.stringify(category, null, 2));
          await fh.sync();
        } finally {
          await fh.close();
        }
      }),
    ]);

    // Write index atomically via temp-then-rename.
    // The tmp file is written to cacheDir (same filesystem as index.json)
    // so rename() is a POSIX atomic op within the same directory.
    const tmpPath = join(this._cacheDir, `.index-${Date.now()}.tmp`);
    const fh = await open(tmpPath, "w");
    try {
      await fh.writeFile(JSON.stringify(this._index, null, 2));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmpPath, this._indexPath);

    this._pendingRecipes.clear();
    this._pendingCategories.clear();
  }
}
```

**Step 1: Create the file**

Write the complete content above to `src/cache/disk-cache.ts`.

**Step 2: Verify type-check passes**

```bash
pnpm typecheck
```

Expected: Zero errors. If `noUncheckedIndexedAccess` causes issues when serialising `this._index` (it shouldn't — `JSON.stringify` takes `object` not indexed access), check the error and adjust.

**Step 3: Verify the module compiles cleanly in isolation**

```bash
pnpm build
```

Expected: Compiles without errors to `dist/`. No stray `.js` output from test files.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Add tests in `src/cache/disk-cache.test.ts`

**Verifies:** p1-u08-disk-cache.AC1.1, p1-u08-disk-cache.AC1.2, p1-u08-disk-cache.AC1.3, p1-u08-disk-cache.AC1.4, p1-u08-disk-cache.AC1.5, p1-u08-disk-cache.AC2.1, p1-u08-disk-cache.AC2.3, p1-u08-disk-cache.AC2.4

**Files:**

- Create: `src/cache/disk-cache.test.ts`
- Reference fixture: `src/cache/__fixtures__/recipes.ts` (has `makeRecipe`, `makeCategory` factory functions — but these are not needed in Phase 2; Phase 3 adds tests that use them)

**Testing:**

Use `vitest`'s `describe`/`it`/`expect` and `beforeEach`/`afterEach`. Use `node:fs/promises` (`mkdtemp`, `rm`, `writeFile`, `readdir`, `stat`, `mkdir`) for real filesystem operations. Import `node:os` for `tmpdir()` and `node:path` for `join()`.

Create a unique temp directory before each test with `mkdtemp(join(tmpdir(), 'paprika-disk-cache-'))` and remove it after with `rm(tempDir, { recursive: true, force: true })`.

Write a `describe('DiskCache')` block containing the following `describe` sections:

**AC1 tests:**

- **p1-u08-disk-cache.AC1.1:** After `new DiskCache(tempDir).init()`, assert `stat(join(tempDir, 'recipes'))` resolves (directory exists) and `stat(join(tempDir, 'categories'))` resolves.

- **p1-u08-disk-cache.AC1.2:** Write a valid `index.json` to `tempDir` containing `{ recipes: { 'uid-1': 'hash-1' }, categories: { 'c-1': 'hash-c' } }`. Create `new DiskCache(tempDir)`, call `init()`, then call `flush()`. Read the written `index.json` back and verify it still contains the same uid → hash entries. (flush() writes `_index` back to disk, so if init() loaded correctly, the data survives the round-trip.)

- **p1-u08-disk-cache.AC1.3:** With a fresh empty `tempDir` (no `index.json`), call `init()`. Then call `flush()`. Read `index.json` and verify it parses to `{ recipes: {}, categories: {} }`.

- **p1-u08-disk-cache.AC1.4:** Write an invalid `index.json` (e.g. `"not valid json structure but parseable"` — a string literal — or `{"wrong": "shape"}`). Create a spy function for `log`. Create `new DiskCache(tempDir, logSpy)`, call `init()`. Assert the log spy was called at least once with a string containing `'corrupt'` or similar. Then call `flush()` and verify `index.json` parses to `{ recipes: {}, categories: {} }` (empty reset).

- **p1-u08-disk-cache.AC1.5:** Create a directory at `join(tempDir, 'index.json')` (i.e. make the index path a directory, not a file). This causes `readFile(indexPath)` to throw with code `EISDIR`, which is not `ENOENT`. Assert `cache.init()` rejects (rethrows).

**AC2 tests:**

- **p1-u08-disk-cache.AC2.1:** Create a fresh DiskCache, call `init()`, then `flush()`. Assert `readFile(join(tempDir, 'index.json'), 'utf-8')` resolves and that `JSON.parse(content)` succeeds without throwing.

- **p1-u08-disk-cache.AC2.3:** Create a fresh DiskCache, call `init()`, then `flush()`. List all entries in `tempDir` with `readdir(tempDir)` and assert no entry ends with `.tmp`.

- **p1-u08-disk-cache.AC2.4:** Create a `new DiskCache(tempDir)` without calling `init()`. Assert `cache.flush()` rejects with an error (any error is acceptable — check it rejects, not what the message says).

**Verification:**

```bash
pnpm test -- src/cache/disk-cache.test.ts
```

Expected: All tests pass. If AC1.4 fails because Zod accepts `{"wrong": "shape"}` as a valid index (the schema is `z.record(z.string(), z.string())` which does accept nested records), use unparseable JSON (`"just a string"` which parses as a string not an object — `JSON.parse('"just a string"')` returns a string and `z.record()` will reject it) or a JSON value with wrong value type (`{"recipes": {"uid": 123}, "categories": {}}` — value 123 is not a string).

**Step 1: Create the test file**

Write `src/cache/disk-cache.test.ts` with all the tests described above.

**Step 2: Run tests**

```bash
pnpm test -- src/cache/disk-cache.test.ts
```

Expected: All 8 tests pass (one per AC case).

**Step 3: Run full test suite to verify no regressions**

```bash
pnpm test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/cache/disk-cache.ts src/cache/disk-cache.test.ts
git commit -m "feat(cache): add DiskCache with init() and flush() — AC1, AC2"
```

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
