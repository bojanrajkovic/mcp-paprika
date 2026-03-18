# Background Sync Engine Implementation Plan — Phase 1

**Goal:** Create the SyncEngine class with working start/stop lifecycle, AbortController-based async loop, and mitt event infrastructure.

**Architecture:** SyncEngine is a single class in `src/paprika/sync.ts` owning a private mitt emitter and an AbortController-based async loop. The public `events` getter narrows the emitter to `on`/`off` only. `syncOnce()` is a stub for this phase, emitting `sync:complete` with an empty `SyncResult`.

**Tech Stack:** TypeScript, mitt (v3.0.1), node:timers/promises (scheduler.wait with AbortSignal)

**Scope:** 2 phases from original design (phase 1 of 2)

**Codebase verified:** 2026-03-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p2-u11-sync-engine.AC1: Lifecycle

- **p2-u11-sync-engine.AC1.1 Success:** `start()` begins the sync loop and runs `syncOnce()` immediately
- **p2-u11-sync-engine.AC1.2 Success:** `stop()` breaks the loop — no further `syncOnce()` calls after stop
- **p2-u11-sync-engine.AC1.3 Edge:** Calling `start()` when already running is a no-op (no duplicate loops)
- **p2-u11-sync-engine.AC1.4 Edge:** Calling `stop()` when not running is a no-op (no error)

### p2-u11-sync-engine.AC2: Events

- **p2-u11-sync-engine.AC2.1 Success:** `events` getter exposes `on` and `off` methods
- **p2-u11-sync-engine.AC2.2 Success:** Handlers registered via `events.on('sync:complete', fn)` receive `SyncResult` payloads
- **p2-u11-sync-engine.AC2.3 Success:** Handlers registered via `events.on('sync:error', fn)` receive `Error` payloads
- **p2-u11-sync-engine.AC2.4 Failure:** `events` getter does NOT expose `emit` (type-level restriction)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: SyncEngine class with types and event infrastructure

**Verifies:** p2-u11-sync-engine.AC1.1, p2-u11-sync-engine.AC1.2, p2-u11-sync-engine.AC1.3, p2-u11-sync-engine.AC1.4, p2-u11-sync-engine.AC2.1, p2-u11-sync-engine.AC2.4

**Files:**

- Create: `src/paprika/sync.ts`

**Context files to read first:**

- `src/types/server-context.ts` — ServerContext interface shape
- `src/paprika/types.ts` — SyncResult type (already defined at line 172)
- `src/paprika/CLAUDE.md` — Module contracts and boundaries

**Implementation:**

Create `src/paprika/sync.ts` with:

1. **SyncEvents type** — maps event names to payload types:

   ```typescript
   type SyncEvents = {
     "sync:complete": SyncResult;
     "sync:error": Error;
   };
   ```

2. **SyncEngine class** with:
   - **Constructor** taking `ServerContext` and `intervalMs: number`. Stores both as private readonly fields. Creates private `_events = mitt<SyncEvents>()`.
   - **`events` getter** returning `Pick<Emitter<SyncEvents>, "on" | "off">` — exposes only subscribe/unsubscribe, hides `emit` and `all` at the type level.
   - **`start()` method** — if `_ac` (AbortController) already exists, return early (no-op for AC1.3). Otherwise creates a new AbortController, stores it as `_ac`, and calls `this._loop()` without awaiting (fire-and-forget).
   - **`stop()` method** — if `_ac` is null, return early (no-op for AC1.4). Otherwise calls `_ac.abort()` and sets `_ac = null`.
   - **`syncOnce()` method** (public, async) — stub for Phase 1. Emits `sync:complete` with an empty SyncResult: `{ added: [], updated: [], removedUids: [] }`. Will be replaced in Phase 2.
   - **`_loop()` private async method** — the core polling loop:
     ```
     while not aborted:
       await this.syncOnce()
       await scheduler.wait(this._intervalMs, { signal: this._ac.signal })
     ```
     The `scheduler.wait()` call from `node:timers/promises` accepts an AbortSignal. When `stop()` aborts the controller, `scheduler.wait()` rejects with an `AbortError` (name: `"AbortError"`). The loop catches this error and exits cleanly. Any non-abort error during the wait is unexpected and should be caught to prevent unhandled rejections.

**Key implementation details:**

- Import `mitt` from `"mitt"` and `type { Emitter }` from `"mitt"` (mitt v3 ships its own types)
- Import `{ scheduler }` from `"node:timers/promises"`
- Import `type { SyncResult }` from `"./types.js"` (SyncResult already exists at `src/paprika/types.ts:172`)
- Import `type { ServerContext }` from `"../types/server-context.js"`
- `_ac` is typed as `AbortController | null`, initialized to `null`
- The `_loop()` method must NOT be awaited in `start()` — it runs as a detached async operation. The loop's promise should have a `.catch(() => {})` no-op handler to prevent unhandled rejection warnings if the loop exits due to abort.
- `SyncEvents` type is not exported (internal to the module)
- Export only `SyncEngine` (named export, no default)

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

**Commit:** `feat(sync): add SyncEngine skeleton with lifecycle and event infrastructure`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: SyncEngine lifecycle and events tests

**Verifies:** p2-u11-sync-engine.AC1.1, p2-u11-sync-engine.AC1.2, p2-u11-sync-engine.AC1.3, p2-u11-sync-engine.AC1.4, p2-u11-sync-engine.AC2.1, p2-u11-sync-engine.AC2.2, p2-u11-sync-engine.AC2.3, p2-u11-sync-engine.AC2.4

**Files:**

- Create: `src/paprika/sync.test.ts`

**Context files to read first:**

- `src/paprika/sync.ts` — the module under test (created in Task 1)
- `src/tools/tool-test-utils.ts` — existing test utility patterns (makeTestServer, makeCtx)
- `src/cache/__fixtures__/recipes.ts` — fixture factories (makeRecipe, makeCategory)
- `src/paprika/CLAUDE.md` — module contracts

**Testing:**

Create `src/paprika/sync.test.ts` with tests organized into `describe("SyncEngine", ...)` blocks.

**Test setup:** Create a helper function that builds a SyncEngine with mocked ServerContext dependencies. The mock ServerContext needs:

- `client`: stub object (no client methods used in Phase 1 syncOnce stub)
- `cache`: stub object (no cache methods used in Phase 1 syncOnce stub)
- `store`: stub object (no store methods used in Phase 1 syncOnce stub)
- `server`: stub object with `sendLoggingMessage: vi.fn()` and `sendResourceListChanged: vi.fn()`

Use a short interval (e.g., 10ms) to keep tests fast. Cast stub objects as the correct types via `as unknown as McpServer` etc. (same pattern as `makeCtx()` in tool-test-utils.ts).

Tests must verify each AC listed above:

- **p2-u11-sync-engine.AC1.1:** `start()` runs `syncOnce()` immediately — register a `sync:complete` handler, call `start()`, use condition-based waiting (poll until handler fires), verify handler received the SyncResult payload. Then `stop()`.

- **p2-u11-sync-engine.AC1.2:** `stop()` breaks the loop — start the engine, wait for at least one `sync:complete` event, then `stop()`. Capture the count of `sync:complete` events at stop time. Wait a reasonable period (e.g., 50ms — longer than the interval). Verify no additional `sync:complete` events fired after stop.

- **p2-u11-sync-engine.AC1.3:** Double `start()` is a no-op — spy on `syncOnce` with `vi.spyOn(engine, "syncOnce")`. Call `start()` twice. Wait for events. Verify `syncOnce` was called the expected number of times (consistent with one loop, not two concurrent loops). Then `stop()`.

- **p2-u11-sync-engine.AC1.4:** `stop()` when not running is a no-op — call `stop()` on a fresh (never-started) engine. Verify no error is thrown.

- **p2-u11-sync-engine.AC2.1:** `events` getter exposes `on` and `off` — verify `typeof engine.events.on === "function"` and `typeof engine.events.off === "function"`.

- **p2-u11-sync-engine.AC2.2:** `sync:complete` handler receives `SyncResult` — register handler via `engine.events.on("sync:complete", handler)`, start engine, wait for handler to be called, verify the payload matches `{ added: [], updated: [], removedUids: [] }` (the stub). Then `stop()`.

- **p2-u11-sync-engine.AC2.3:** `sync:error` handler receives `Error` — make `syncOnce` throw (via `vi.spyOn` + `mockRejectedValueOnce` or by temporarily replacing it), start engine, wait for `sync:error` handler to fire, verify the payload is an Error instance. Then `stop()`. **Note:** This test is only possible if the loop catches syncOnce errors and emits them — verify the loop handles this. If the Phase 1 stub never throws, this test can mock `syncOnce` to throw once to exercise the error path.

- **p2-u11-sync-engine.AC2.4:** `events` does not expose `emit` — this is a compile-time check. Add a TypeScript type assertion test using `expectTypeOf` from vitest:
  ```typescript
  expectTypeOf(engine.events).not.toHaveProperty("emit");
  ```

**Important test considerations:**

- Always call `engine.stop()` in `afterEach` or at the end of each test to prevent dangling loops
- Use condition-based waiting (poll for event handler calls) rather than arbitrary `setTimeout` delays
- Keep interval short (10ms) so loop iterations are fast
- Tests should complete within vitest's default timeout

**Verification:**

Run: `pnpm test -- src/paprika/sync.test.ts`
Expected: All tests pass

Run: `pnpm typecheck`
Expected: No type errors

**Commit:** `test(sync): add SyncEngine lifecycle and events tests`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
