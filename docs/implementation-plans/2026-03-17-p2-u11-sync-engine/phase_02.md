# Background Sync Engine Implementation Plan — Phase 2

**Goal:** Implement the full `syncOnce` algorithm: recipe diff-and-fetch, category replace-all, cache flush, MCP notification, logging, and error handling.

**Architecture:** Replace the Phase 1 `syncOnce()` stub with the complete sync cycle. Recipe sync diffs remote entries against the disk cache, fetches only changed recipes, and updates both cache and store. Category sync uses a replace-all strategy. After mutations, the cache is flushed once, MCP clients are notified of resource changes, and a `sync:complete` event is emitted. All errors are caught, logged via `sendLoggingMessage`, and emitted as `sync:error` — `syncOnce()` never throws.

**Tech Stack:** TypeScript, mitt (v3.0.1), @modelcontextprotocol/sdk (sendLoggingMessage, sendResourceListChanged)

**Scope:** 2 phases from original design (phase 2 of 2)

**Codebase verified:** 2026-03-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p2-u11-sync-engine.AC3: Recipe Sync

- **p2-u11-sync-engine.AC3.1 Success:** Added recipes are fetched, written to cache, and set in store
- **p2-u11-sync-engine.AC3.2 Success:** Changed recipes are fetched, written to cache, and updated in store
- **p2-u11-sync-engine.AC3.3 Success:** Removed recipes are deleted from cache and store
- **p2-u11-sync-engine.AC3.4 Success:** `sync:complete` event contains correct `SyncResult` — added vs updated partitioned correctly, removedUids populated
- **p2-u11-sync-engine.AC3.5 Edge:** No changes detected → `sync:complete` emitted with empty arrays

### p2-u11-sync-engine.AC4: Category Sync

- **p2-u11-sync-engine.AC4.1 Success:** `store.setCategories()` called with all fetched categories
- **p2-u11-sync-engine.AC4.2 Success:** `cache.putCategory()` called for each category

### p2-u11-sync-engine.AC5: Notifications

- **p2-u11-sync-engine.AC5.1 Success:** `sendResourceListChanged()` called when recipe changes exist
- **p2-u11-sync-engine.AC5.2 Edge:** `sendResourceListChanged()` NOT called when no recipe changes detected

### p2-u11-sync-engine.AC6: Resilience

- **p2-u11-sync-engine.AC6.1 Success:** `syncOnce()` never throws — API errors are caught
- **p2-u11-sync-engine.AC6.2 Success:** `sync:error` emitted with the caught Error
- **p2-u11-sync-engine.AC6.3 Success:** Next sync cycle runs after a failed cycle

### p2-u11-sync-engine.AC7: Logging

- **p2-u11-sync-engine.AC7.1 Success:** `sendLoggingMessage` called with level `"info"` on successful sync
- **p2-u11-sync-engine.AC7.2 Success:** `sendLoggingMessage` called with level `"error"` on failed sync

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Implement full syncOnce algorithm

**Verifies:** p2-u11-sync-engine.AC3.1, p2-u11-sync-engine.AC3.2, p2-u11-sync-engine.AC3.3, p2-u11-sync-engine.AC3.4, p2-u11-sync-engine.AC3.5, p2-u11-sync-engine.AC4.1, p2-u11-sync-engine.AC4.2, p2-u11-sync-engine.AC5.1, p2-u11-sync-engine.AC5.2, p2-u11-sync-engine.AC6.1, p2-u11-sync-engine.AC6.2, p2-u11-sync-engine.AC7.1, p2-u11-sync-engine.AC7.2

**Files:**

- Modify: `src/paprika/sync.ts` (replace syncOnce stub with full implementation)

**Context files to read first:**

- `src/paprika/sync.ts` — the Phase 1 skeleton (created in Phase 1)
- `src/paprika/types.ts` — SyncResult, DiffResult, Recipe, Category, RecipeEntry types
- `src/cache/disk-cache.ts` — DiskCache methods: diffRecipes(), putRecipe(), removeRecipe(), putCategory(), flush()
- `src/cache/recipe-store.ts` — RecipeStore methods: set(), delete(), setCategories()
- `src/paprika/client.ts` — PaprikaClient methods: listRecipes(), getRecipes(), listCategories()
- `src/cache/CLAUDE.md` — DiskCache and RecipeStore contracts
- `src/paprika/CLAUDE.md` — PaprikaClient contracts

**Implementation:**

Replace the `syncOnce()` stub with the full algorithm. The entire method body is wrapped in `try/catch` — it must never throw.

**syncOnce algorithm:**

1. **Recipe sync path:**
   - Call `ctx.client.listRecipes()` → `Array<RecipeEntry>`
   - Call `ctx.cache.diffRecipes(entries)` → `DiffResult` (synchronous)
   - Compute UIDs to fetch: `[...diff.added, ...diff.changed]`
   - If UIDs to fetch exist, call `ctx.client.getRecipes(uidsToFetch)` → `Array<Recipe>`
   - For each fetched recipe: `ctx.cache.putRecipe(recipe, recipe.hash)` (sync) and `ctx.store.set(recipe)` (sync)
   - For each removed UID: `await ctx.cache.removeRecipe(uid)` (async) and `ctx.store.delete(uid as RecipeUid)` (sync)
   - Partition fetched recipes: a recipe is "added" if its UID is in `diff.added`, otherwise "updated". Build a `Set` from `diff.added` for O(1) lookup.

2. **Category sync path (replace-all):**
   - Call `ctx.client.listCategories()` → `Array<Category>` (fully hydrated)
   - Call `ctx.store.setCategories(categories)` (sync)
   - For each category: `ctx.cache.putCategory(category, category.uid)` (sync) — uses `category.uid` as placeholder hash per design

3. **Finalization:**
   - Call `await ctx.cache.flush()` — single call after all mutations
   - Determine if recipe changes exist: `diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0`
   - If recipe changes exist: call `ctx.server.sendResourceListChanged()` (sync, returns void)
   - Build `SyncResult`: `{ added, updated, removedUids: diff.removed }`
   - Emit `sync:complete` with the SyncResult — always emitted, even when nothing changed
   - Log success: `await ctx.server.sendLoggingMessage({ level: "info", data: "Sync complete: N added, N updated, N removed" })`

4. **Error handling (catch block):**
   - Convert caught value to Error if needed: `const error = value instanceof Error ? value : new Error(String(value))`
   - Log error: `await ctx.server.sendLoggingMessage({ level: "error", data: "Sync failed: <error.message>" })` — wrap in try/catch since logging itself may throw if not connected
   - Emit `sync:error` with the Error
   - Do NOT re-throw — return normally

**Key implementation details:**

- Import `type { RecipeUid }` from `"./types.js"` — needed for casting removed UID strings to branded type for `store.delete()`
- Import `type { DiffResult, SyncResult, Recipe, Category, RecipeEntry }` from `"./types.js"`
- `sendLoggingMessage` is async (returns `Promise<void>`) — await it, but wrap in try/catch since it may throw `"Not connected"` if transport isn't attached yet
- `sendResourceListChanged` is sync (returns `void`) — call without await
- `removeRecipe` is async (deletes file from disk) — must await each call. Use `Promise.all` for concurrent removal: `await Promise.all(diff.removed.map(uid => ctx.cache.removeRecipe(uid)))`
- The design specifies all-or-nothing for `getRecipes()` — if any recipe fetch fails, the entire sync cycle errors. This is acceptable per design.

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

**Commit:** `feat(sync): implement syncOnce with recipe diff, category replace-all, and error handling`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: syncOnce behavior tests

**Verifies:** p2-u11-sync-engine.AC3.1, p2-u11-sync-engine.AC3.2, p2-u11-sync-engine.AC3.3, p2-u11-sync-engine.AC3.4, p2-u11-sync-engine.AC3.5, p2-u11-sync-engine.AC4.1, p2-u11-sync-engine.AC4.2, p2-u11-sync-engine.AC5.1, p2-u11-sync-engine.AC5.2, p2-u11-sync-engine.AC6.1, p2-u11-sync-engine.AC6.2, p2-u11-sync-engine.AC6.3, p2-u11-sync-engine.AC7.1, p2-u11-sync-engine.AC7.2

**Files:**

- Modify: `src/paprika/sync.test.ts` (add syncOnce behavior tests to existing test file)

**Context files to read first:**

- `src/paprika/sync.ts` — the full implementation (modified in Task 1)
- `src/paprika/sync.test.ts` — existing Phase 1 lifecycle tests (created in Phase 1, Task 2)
- `src/tools/tool-test-utils.ts` — existing makeTestServer/makeCtx patterns
- `src/cache/__fixtures__/recipes.ts` — makeRecipe() and makeCategory() factories
- `src/paprika/types.ts` — RecipeEntry, DiffResult, SyncResult types

**Testing:**

Add a new `describe("syncOnce", ...)` block to the existing `src/paprika/sync.test.ts` file.

**Test setup:** Build a helper that creates a SyncEngine with fully mocked ServerContext dependencies for syncOnce testing. Each mock needs:

- `client.listRecipes`: `vi.fn()` returning `Array<RecipeEntry>` — controls what the "server" reports
- `client.getRecipes`: `vi.fn()` returning `Array<Recipe>` — controls what gets fetched
- `client.listCategories`: `vi.fn()` returning `Array<Category>` — controls category fetch
- `cache.diffRecipes`: `vi.fn()` returning `DiffResult` — controls what the diff detects
- `cache.putRecipe`: `vi.fn()` — spy on recipe cache writes
- `cache.removeRecipe`: `vi.fn().mockResolvedValue(undefined)` — spy on recipe cache removes (async)
- `cache.putCategory`: `vi.fn()` — spy on category cache writes
- `cache.flush`: `vi.fn().mockResolvedValue(undefined)` — spy on cache flush (async)
- `store.set`: `vi.fn()` — spy on store recipe writes
- `store.delete`: `vi.fn()` — spy on store recipe deletes
- `store.setCategories`: `vi.fn()` — spy on store category replacement
- `server.sendResourceListChanged`: `vi.fn()` — spy on MCP resource notification
- `server.sendLoggingMessage`: `vi.fn().mockResolvedValue(undefined)` — spy on MCP logging (async)

Use `makeRecipe()` and `makeCategory()` from `src/cache/__fixtures__/recipes.ts` to build test data. Create `RecipeEntry` objects from recipes: `{ uid: recipe.uid, hash: recipe.hash }`.

Tests must verify each AC listed above:

- **p2-u11-sync-engine.AC3.1:** Added recipes are fetched, written to cache, and set in store — configure `diffRecipes` to return `{ added: [uid1], changed: [], removed: [] }`, `listRecipes` to return matching entries, `getRecipes` to return recipe objects. Call `syncOnce()`. Verify `cache.putRecipe` called with the recipe and its hash. Verify `store.set` called with the recipe.

- **p2-u11-sync-engine.AC3.2:** Changed recipes — same as AC3.1 but UID is in `changed` array instead of `added`. Verify same cache/store updates.

- **p2-u11-sync-engine.AC3.3:** Removed recipes — configure `diffRecipes` to return `{ added: [], changed: [], removed: [uid1] }`. Verify `cache.removeRecipe` called with the UID. Verify `store.delete` called with the UID.

- **p2-u11-sync-engine.AC3.4:** SyncResult partitioning — configure diff with both `added` and `changed` UIDs. Register a `sync:complete` handler. Call `syncOnce()`. Verify the SyncResult payload has the correct recipes in `added` vs `updated` arrays, and `removedUids` matches `diff.removed`.

- **p2-u11-sync-engine.AC3.5:** No changes detected — configure `diffRecipes` returning `{ added: [], changed: [], removed: [] }`. Register `sync:complete` handler. Call `syncOnce()`. Verify handler received `{ added: [], updated: [], removedUids: [] }`.

- **p2-u11-sync-engine.AC4.1:** Categories set in store — configure `listCategories` to return category array. Call `syncOnce()`. Verify `store.setCategories` called with the same categories.

- **p2-u11-sync-engine.AC4.2:** Categories written to cache — verify `cache.putCategory` called once per category with `(category, category.uid)` as arguments.

- **p2-u11-sync-engine.AC5.1:** Notification on changes — configure diff with at least one added/changed/removed UID. Call `syncOnce()`. Verify `server.sendResourceListChanged` called.

- **p2-u11-sync-engine.AC5.2:** No notification on no changes — configure empty diff. Call `syncOnce()`. Verify `server.sendResourceListChanged` NOT called.

- **p2-u11-sync-engine.AC6.1:** syncOnce never throws — make `client.listRecipes` throw an Error. Call `syncOnce()`. Verify it returns normally (does not throw/reject).

- **p2-u11-sync-engine.AC6.2:** sync:error emitted — make `client.listRecipes` throw. Register `sync:error` handler. Call `syncOnce()`. Verify handler received the Error.

- **p2-u11-sync-engine.AC6.3:** Next cycle runs after failure — start the engine with short interval, make `listRecipes` throw on first call and succeed on second. Wait for `sync:complete` event (second cycle). Verify it fires. Stop the engine.

- **p2-u11-sync-engine.AC7.1:** Info logging on success — call `syncOnce()` with happy path mocks. Verify `server.sendLoggingMessage` called with an object containing `level: "info"`.

- **p2-u11-sync-engine.AC7.2:** Error logging on failure — make `client.listRecipes` throw. Call `syncOnce()`. Verify `server.sendLoggingMessage` called with an object containing `level: "error"`.

**Important test considerations:**

- Call `syncOnce()` directly in most tests (don't use start/stop lifecycle) — this isolates sync behavior from loop behavior
- Use `engine.events.on("sync:complete", handler)` to capture SyncResult payloads
- Always call `engine.stop()` if you called `engine.start()` (in afterEach or at end of test)
- For AC6.3, use start/stop lifecycle with short interval to test cycle recovery

**Verification:**

Run: `pnpm test -- src/paprika/sync.test.ts`
Expected: All tests pass

Run: `pnpm typecheck`
Expected: No type errors

**Commit:** `test(sync): add syncOnce behavior tests for recipe/category sync, notifications, resilience, and logging`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->

### Task 3: Document SyncEngine in CLAUDE.md

**Verifies:** None (documentation task)

**Files:**

- Modify: `src/paprika/CLAUDE.md` (add SyncEngine section)

**Context files to read first:**

- `src/paprika/sync.ts` — the completed implementation
- `src/paprika/CLAUDE.md` — existing module documentation

**Implementation:**

Add a `### SyncEngine (sync.ts)` section to `src/paprika/CLAUDE.md` documenting:

1. **Purpose** — Background polling loop that keeps local cache and in-memory store synchronized with Paprika Cloud Sync API
2. **Construction** — `new SyncEngine(ctx: ServerContext, intervalMs: number)`
3. **Public API:**
   - `start(): void` — begins async polling loop (no-op if already running)
   - `stop(): void` — aborts loop via AbortController (no-op if not running)
   - `syncOnce(): Promise<void>` — runs one full sync cycle, never throws
   - `events` getter — `Pick<Emitter<SyncEvents>, "on" | "off">` for subscribing to `sync:complete` (SyncResult) and `sync:error` (Error)
4. **Invariants:**
   - `syncOnce()` never throws — errors are caught, logged, and emitted
   - `start()` when already running is a no-op (no duplicate loops)
   - `stop()` when not running is a no-op
   - Recipe changes trigger `sendResourceListChanged()`; no-change cycles do not
   - Cache is flushed exactly once per cycle (after all mutations)
5. **Dependencies:**
   - Uses: `ServerContext` (client, cache, store, server), `mitt`, `node:timers/promises`
   - Used by: entry point (P2-U12), Phase 3 event subscribers
   - Boundary: Does not import from `tools/`, `resources/`, or `features/`

**Verification:**

Run: `pnpm format:check`
Expected: No formatting issues (or fix with `pnpm format`)

**Commit:** `docs(sync): document SyncEngine contract and dependencies in CLAUDE.md`

<!-- END_TASK_3 -->
