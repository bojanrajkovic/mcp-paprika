# DiskCache Implementation Plan — Phase 5: Documentation and Final Verification

**Goal:** Update `src/cache/CLAUDE.md` to document the `DiskCache` class contract. Verify all quality gates pass with adequate test coverage.

**Architecture:** Documentation-only phase. No new source code. No new tests.

**Tech Stack:** Markdown

**Scope:** Phase 5 of 5 from the original design

**Codebase verified:** 2026-03-10

---

## Acceptance Criteria Coverage

**Verifies: None** — This phase produces documentation and runs quality gates. All ACs were implemented in Phases 2–4.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: Update `src/cache/CLAUDE.md` with `DiskCache` contract

**Files:**

- Modify: `src/cache/CLAUDE.md`

**Step 1: Update the file header date**

Change the `Last verified:` date at the top of the file to `2026-03-10`.

**Step 2: Add `disk-cache.ts` to the Files section**

In the `## Files` section, add:

```markdown
- `disk-cache.ts` — Persistent disk cache for the Paprika recipe library between server restarts
```

**Step 3: Add DiskCache to the Contracts section**

After the existing `### RecipeStore` subsection, add:

```markdown
### DiskCache

Persistence layer for the Paprika recipe library. Stores full recipe and category JSON on disk and maintains an in-memory index (`uid → hash`) for efficient sync diffing. Must be initialised with `init()` before any other method is called. All writes are deferred: `put*()` buffers to memory; `flush()` writes everything atomically.

**Construction:**

`new DiskCache(cacheDir: string, log?: (msg: string) => void)`

- `cacheDir` — absolute path to the cache directory (typically from `getCacheDir()` in `src/utils/xdg.ts`)
- `log` — optional log callback injected by the entry point; defaults to a no-op

**Lifecycle:**

| Method    | Signature           | Description                                                                       |
| --------- | ------------------- | --------------------------------------------------------------------------------- |
| `init()`  | `(): Promise<void>` | Creates `recipes/` and `categories/` subdirs; loads or recovers `index.json`      |
| `flush()` | `(): Promise<void>` | Writes all pending files (fsynced), commits index atomically via temp-then-rename |

**Recipe methods:**

| Method                    | Signature                                       | Description                                                                   |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `getRecipe(uid)`          | `(uid: string): Promise<Recipe \| null>`        | Returns pending entry or reads/validates from disk; `null` on miss            |
| `putRecipe(recipe, hash)` | `(recipe: Recipe, hash: string): Promise<void>` | Buffers to pending map; updates `_index` in memory; no file I/O               |
| `removeRecipe(uid)`       | `(uid: string): Promise<void>`                  | Deletes file (idempotent); removes from `_index` and pending map              |
| `getAllRecipes()`         | `(): Promise<Array<Recipe>>`                    | Merges pending map with all `.json` files in `recipes/`; pending shadows disk |

**Category methods:**

| Method                        | Signature                                           | Description                                                        |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `getCategory(uid)`            | `(uid: string): Promise<Category \| null>`          | Returns pending entry or reads/validates from disk; `null` on miss |
| `putCategory(category, hash)` | `(category: Category, hash: string): Promise<void>` | Buffers to pending map; updates `_index` in memory; no file I/O    |

**Diff methods (synchronous):**

| Method                    | Signature                                             | Description                                                                      |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `diffRecipes(entries)`    | `(entries: ReadonlyArray<RecipeEntry>): DiffResult`   | Classifies remote entries vs local recipe index into `added`/`changed`/`removed` |
| `diffCategories(entries)` | `(entries: ReadonlyArray<CategoryEntry>): DiffResult` | Same algorithm applied to category index                                         |
```

**Step 4: Add DiskCache invariants to the Invariants section**

Add to the `## Invariants` section:

```markdown
- `DiskCache` requires `init()` before `flush()`, `diffRecipes()`, `diffCategories()`, `putRecipe()`, `putCategory()`, or `removeRecipe()` — calling any of these before `init()` throws
- `flush()` must be called after each batch of `put*()` calls to persist data to disk; until then, data lives only in memory and will be lost on restart
- `getAllRecipes()` merges pending (not-yet-flushed) entries with disk files; pending entries shadow disk for the same UID
- There is no `removeCategory()` or `getAllCategories()` — categories are always re-synced from the API; the cache only stores them for diffing
- `diffRecipes()` and `diffCategories()` reflect `putRecipe()`/`putCategory()` calls immediately (before `flush()`) because `put*()` updates `_index` in memory
```

**Step 5: Update the Dependencies section**

Add `DiskCache` to the "Used by" note:

```markdown
- **Used by:** `features/` (via RecipeStore), P2-U11 sync engine (via DiskCache), P2-U12 entry point (constructs DiskCache with `getCacheDir()` and injects log callback)
```

**Step 6: Verify the file looks correct**

Read `src/cache/CLAUDE.md` and confirm the additions are correctly placed and formatted.

**Step 7: Commit**

```bash
git add src/cache/CLAUDE.md
git commit -m "docs(cache): add DiskCache contract to CLAUDE.md"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Run all quality gates

**Files:** No file changes.

**Step 1: Lint**

```bash
pnpm lint
```

Expected: No errors, no warnings (lint runs with `--deny-warnings`). If there are oxlint violations in `disk-cache.ts` or `disk-cache.test.ts`, fix them before proceeding.

Common issues to look for:

- `no-console` violations (DiskCache uses an injectable `log` callback, not `console.log` — should be clean)
- Unused variables
- Any TypeScript-related lint rules

**Step 2: Format check**

```bash
pnpm format:check
```

Expected: No formatting issues. If there are, run `pnpm format` to auto-fix, then re-check.

**Step 3: Type-check**

```bash
pnpm typecheck
```

Expected: Zero errors.

**Step 4: Test suite**

```bash
pnpm test
```

Expected: All tests pass with no failures.

**Step 5: Coverage check**

```bash
pnpm test -- --coverage
```

Expected: `disk-cache.ts` has ≥ 70% line/branch coverage. If coverage is below 70%, add targeted tests for the uncovered branches (check the coverage report to identify which lines are not covered).

Likely coverage gaps to check:

- `JSON.parse` failure branch in `init()` (invalid JSON that is not schema-invalid, but throws on parse)
- Non-ENOENT error in `getRecipe`/`getCategory` disk read
- `getAllRecipes()` non-ENOENT error from `readdir`

**Step 6: If any gate fails, fix the issue before marking this task complete**

Do not bypass hooks or skip checks. Fix the root cause.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Final commit

**Files:** No file changes.

**Step 1: Verify the implementation plan directory**

```bash
ls docs/implementation-plans/2026-03-10-p1-u08-disk-cache/
```

Expected: `phase_01.md`, `phase_02.md`, `phase_03.md`, `phase_04.md`, `phase_05.md` (plus `test-requirements.md` if the test requirements generation task has already run — that file is generated separately as part of the planning process, not by implementation).

**Step 2: Verify branch is clean**

```bash
git status
```

Expected: Working tree clean. All changes committed.

**Step 3: Summary of what was built**

This completes the disk cache implementation:

- `src/paprika/types.ts`: `RecipeStoredSchema`, `CategoryStoredSchema`, `recipeCamelShape`, `categoryCamelShape` added; `Recipe`/`Category` types rederived
- `src/cache/disk-cache.ts`: Full `DiskCache` class with init, flush, recipe CRUD, category CRUD, and diff methods
- `src/cache/disk-cache.test.ts`: Tests covering all 30+ AC cases
- `src/cache/CLAUDE.md`: Updated with DiskCache contract
  <!-- END_TASK_3 -->
  <!-- END_SUBCOMPONENT_A -->
