# Human Test Plan: Background Sync Engine (p2-u11-sync-engine)

## Prerequisites

- Node.js 24 runtime (managed via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test` (380 tests, 22 files, all green)

## Phase 1: Lifecycle Smoke Test (Structural Review)

| Step | Action                                                                                          | Expected                                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `src/paprika/sync.ts` and inspect the `start()` method                                     | Method checks `this._ac !== null` and returns early (no-op) if already running; otherwise creates a new `AbortController` and launches `_loop()`                       |
| 2    | Inspect the `stop()` method                                                                     | Method checks `this._ac === null` and returns early if not running; otherwise calls `this._ac.abort()` and sets `this._ac = null`                                      |
| 3    | Inspect the `_loop()` method                                                                    | Loop runs `syncOnce()` in a `while(true)` loop, uses `scheduler.wait(intervalMs, { signal })` between iterations, catches `AbortError` from the signal to cleanly exit |
| 4    | Verify that `syncOnce()` is called immediately in the loop (no initial delay before first call) | `_loop()` calls `await this.syncOnce()` as the first statement inside the while loop, before the `scheduler.wait` call                                                 |

## Phase 2: Event System Design Review

| Step | Action                                                   | Expected                                                                                                |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1    | Verify the `events` getter return type                   | Returns `Pick<SyncEventEmitter, "on" \| "off">` -- excludes `emit` from the public surface              |
| 2    | Verify the `_eventsView` construction in the constructor | Creates an object with only `on` and `off` bound to the internal mitt emitter -- `emit` is not included |
| 3    | Confirm the `SyncEvents` type definition                 | Defines two events: `"sync:complete": SyncResult` and `"sync:error": Error`                             |

## Phase 3: syncOnce Algorithm Correctness Review

| Step | Action                                          | Expected                                                                                                                                                                                  |
| ---- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Trace the recipe sync path in `syncOnce()`      | Calls `listRecipes()`, then `diffRecipes()`, computes UIDs to fetch as `[...added, ...changed]`, fetches via `getRecipes()`, writes to both cache and store, then removes deleted recipes |
| 2    | Verify added/changed partitioning logic         | Uses a `Set` of `diff.added` UIDs to filter `fetchedRecipes` into `addedRecipes` and `updatedRecipes`                                                                                     |
| 3    | Verify category sync is replace-all             | Fetches all categories, calls `store.setCategories(categories)` once, then iterates to call `cache.putCategory` per category                                                              |
| 4    | Verify cache flush happens exactly once         | Single `await this._context.cache.flush()` after all mutations                                                                                                                            |
| 5    | Verify `sendResourceListChanged` is conditional | Only called when `diff.added.length > 0 \|\| diff.changed.length > 0 \|\| diff.removed.length > 0`                                                                                        |

## Phase 4: Error Handling Path Review

| Step | Action                                                     | Expected                                                                                                                                       |
| ---- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Verify outer try/catch in `syncOnce()`                     | Entire method body is wrapped in try/catch; catch block converts to Error, logs, emits `sync:error`, and does not re-throw                     |
| 2    | Verify logging is resilient                                | Both success and error logging calls are individually wrapped in try/catch to handle disconnected MCP clients                                  |
| 3    | Verify `_loop()` has a defensive catch around `syncOnce()` | Even though `syncOnce()` should never throw per AC6.1, the loop wraps the call in try/catch and emits `sync:error` if the contract is violated |

## End-to-End: Full Sync Cycle Verification

**Purpose:** Validate that a complete sync cycle correctly orchestrates all subsystems.

1. Trace execution order for a cycle where 1 recipe is added, 1 is changed, and 1 is removed
2. Verify order: `listRecipes()` -> `diffRecipes()` -> `getRecipes([added, changed])` -> per-recipe `putRecipe()` + `store.set()` -> concurrent `removeRecipe()` for removed -> `listCategories()` -> `setCategories()` -> per-category `putCategory()` -> `flush()` -> conditional `sendResourceListChanged()` -> emit `sync:complete` -> `sendLoggingMessage(info)`
3. Confirm `removedUids` in SyncResult contains raw string UIDs from the diff
4. Confirm test AC3.4 exercises this exact scenario and validates all partitions

## End-to-End: Error Recovery Across Cycles

**Purpose:** Validate that a failed sync cycle does not poison subsequent cycles.

1. Read test AC6.3 and trace the mock setup: `listRecipes` throws on call 1, succeeds on call 2
2. Verify in `_loop()` that after `syncOnce()` catches the error internally and returns normally, `scheduler.wait()` proceeds, and the next iteration calls `syncOnce()` again
3. Confirm the test asserts both an error event (from cycle 1) and a complete event (from cycle 2)
4. Verify no shared mutable state in `syncOnce()` that could leak between cycles

## Human Verification Required

No acceptance criteria require human verification. All 22 criteria (AC1.1 through AC7.2) are covered by automated unit tests. The structural reviews above provide additional confidence beyond what unit tests verify.

## Traceability

| Acceptance Criterion                        | Automated Test   | Manual Step          |
| ------------------------------------------- | ---------------- | -------------------- |
| AC1.1 start() runs syncOnce immediately     | sync.test.ts:65  | Phase 1, Step 4      |
| AC1.2 stop() breaks the loop                | sync.test.ts:94  | Phase 1, Steps 2-3   |
| AC1.3 Double start() is a no-op             | sync.test.ts:122 | Phase 1, Step 1      |
| AC1.4 stop() when not running is a no-op    | sync.test.ts:156 | Phase 1, Step 2      |
| AC2.1 events exposes on and off             | sync.test.ts:165 | Phase 2, Step 1      |
| AC2.2 sync:complete receives SyncResult     | sync.test.ts:170 | Phase 2, Step 3      |
| AC2.3 sync:error receives Error             | sync.test.ts:198 | Phase 2, Step 3      |
| AC2.4 events does not expose emit           | sync.test.ts:231 | Phase 2, Steps 1-2   |
| AC3.1 Added recipes fetched/cached/stored   | sync.test.ts:290 | Phase 3, Step 1      |
| AC3.2 Changed recipes fetched/cached/stored | sync.test.ts:316 | Phase 3, Step 1      |
| AC3.3 Removed recipes deleted               | sync.test.ts:342 | Phase 3, Step 1      |
| AC3.4 SyncResult partitions correctly       | sync.test.ts:362 | Phase 3, Step 2; E2E |
| AC3.5 No changes yields empty result        | sync.test.ts:408 | Phase 3, Step 5      |
| AC4.1 setCategories called with all         | sync.test.ts:425 | Phase 3, Step 3      |
| AC4.2 putCategory called per category       | sync.test.ts:445 | Phase 3, Step 3      |
| AC5.1 sendResourceListChanged on changes    | sync.test.ts:465 | Phase 3, Step 5      |
| AC5.2 sendResourceListChanged not on empty  | sync.test.ts:489 | Phase 3, Step 5      |
| AC6.1 syncOnce never throws                 | sync.test.ts:500 | Phase 4, Step 1      |
| AC6.2 sync:error emitted with Error         | sync.test.ts:509 | Phase 4, Step 1      |
| AC6.3 Next cycle runs after failure         | sync.test.ts:526 | Phase 4, Step 3; E2E |
| AC7.1 Info logging on success               | sync.test.ts:564 | Phase 4, Step 2      |
| AC7.2 Error logging on failure              | sync.test.ts:579 | Phase 4, Step 2      |
