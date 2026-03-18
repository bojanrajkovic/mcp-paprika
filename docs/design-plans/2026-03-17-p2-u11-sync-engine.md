# Background Sync Engine Design

## Summary

The `SyncEngine` is a background polling loop that keeps the local cache and in-memory recipe store synchronized with the Paprika Cloud Sync API. It runs on a configurable interval, compares the server's current recipe list against what is stored on disk (using content hashes to detect additions, modifications, and deletions), fetches only the recipes that have changed, and applies those changes to both the persistent disk cache and the in-memory `RecipeStore`. Categories are smaller and have no meaningful hash-based diffing, so they are always fetched in full and replaced atomically. After each cycle, the engine notifies connected MCP clients that resources may have changed, allowing AI assistants to see up-to-date recipe data without requiring a restart.

The implementation uses a single `AbortController`-based async loop (Node.js built-ins only) to guarantee that sync cycles run sequentially with no overlap. The existing `PaprikaClient` bulkhead limits concurrent API calls during recipe fetches. Events are dispatched via a `mitt` emitter whose public surface is narrowed to `on`/`off` only — external code can subscribe to `sync:complete` and `sync:error` but cannot inject fake events. The engine is failure-tolerant: `syncOnce()` never throws, individual cycle failures are caught and re-attempted on the next interval, and all diagnostics are routed through the MCP protocol's native logging channel rather than stdout (which would corrupt the wire format).

## Definition of Done

The `SyncEngine` class in `src/paprika/sync.ts` periodically syncs recipes and categories from the Paprika API into the local cache and in-memory store, notifies MCP clients of changes via `sendResourceListChanged()`, and emits typed mitt events for downstream subscribers (Phase 3).

**Deliverables:**

1. **SyncEngine class** with `start()`, `stop()`, `syncOnce()` lifecycle and a getter-only `events` property exposing `on`/`off` (mitt, with `emit` kept private)
2. **Recipe sync**: diff remote recipe entries against cache (`diffRecipes`), fetch changed recipes via `getRecipes()` (uses internal bulkhead), update cache + store
3. **Category sync**: replace-all approach — `listCategories()` → `store.setCategories()` + `cache.putCategory()` for each (no diffing, categories are small)
4. **Logging**: All diagnostics via `server.sendLoggingMessage()` (MCP protocol-native; no console output)
5. **Resilience**: `syncOnce()` never throws; individual recipe fetch failures are non-fatal (partial sync completes); errors emitted as `sync:error`
6. **Events**: `sync:complete` with `SyncResult` payload, `sync:error` with `Error` payload
7. **Out of scope**: entry-point wiring (P2-U12), Phase 3 event subscribers, custom concurrency limiter

## Acceptance Criteria

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

## Glossary

- **AbortController**: A browser-standard (also available in Node.js) API for cancelling asynchronous operations. `SyncEngine` uses it to interrupt the `scheduler.wait()` sleep when `stop()` is called, breaking the loop without races or timers that need manual cleanup.
- **bulkhead**: A cockatiel resilience primitive that limits the number of concurrent executions of an operation. `PaprikaClient` applies a bulkhead of 5 to recipe and category fetches so the sync engine cannot flood the Paprika API with parallel requests.
- **cockatiel**: A Node.js resilience library providing retry, circuit breaker, and bulkhead patterns. Used by `PaprikaClient` to protect outbound API calls.
- **DiffResult**: A plain object `{added, changed, removed}` returned by `DiskCache.diffRecipes()`. Each field is an array of UIDs classifying how the remote recipe list differs from what is locally cached.
- **DiskCache**: The persistent on-disk layer that stores full recipe and category JSON files and maintains an in-memory `uid → hash` index used for change detection across server restarts.
- **mitt**: A tiny typed event emitter library. `SyncEngine` uses it internally and narrows the public `events` getter to `Pick<Emitter, 'on' | 'off'>` so callers can subscribe but cannot emit.
- **RecipeEntry**: A lightweight object `{uid, hash}` returned by the Paprika list endpoint. Entries are used for diffing — full recipe content is only fetched for entries that differ from the cache.
- **RecipeStore**: The in-memory query layer holding all non-trashed recipes and categories. Tools and resources read from the store; the sync engine keeps it current by calling `store.set()`, `store.delete()`, and `store.setCategories()` after each cycle.
- **replace-all (category sync)**: The strategy of fetching all categories from the API and overwriting the entire local set each cycle, rather than diffing. Used because the API does not expose a reliable hash-based list for categories.
- **scheduler.wait()**: `node:timers/promises` utility that returns a promise resolving after a given delay, with optional `AbortSignal` support. The sync loop uses it for the inter-cycle sleep so `stop()` can interrupt it immediately.
- **sendLoggingMessage()**: An MCP SDK method for sending diagnostic log messages to connected clients over the protocol. Used instead of `console.log` (which would corrupt the stdio wire format).
- **sendResourceListChanged()**: An MCP SDK method that sends a protocol notification to connected clients indicating that the server's resource list may have changed.
- **ServerContext**: A plain immutable record (`{client, cache, store, server}`) constructed once at startup and injected into tools, resources, and the sync engine as a dependency container.
- **SyncResult**: The event payload emitted with `sync:complete` — `{added: Recipe[], updated: Recipe[], removedUids: string[]}` — describing what changed during a sync cycle.

## Architecture

SyncEngine is a single class in `src/paprika/sync.ts` that owns an AbortController-based async loop and a private mitt event emitter.

### Lifecycle

The constructor takes `ServerContext` and `intervalMs`. `start()` creates an AbortController and enters an async loop: run `syncOnce()`, sleep `intervalMs` via `scheduler.wait()` from `node:timers/promises` (abortable), repeat. `stop()` aborts the controller, breaking the sleep and exiting the loop. The AbortController approach guarantees sequential execution — no overlap between sync cycles, no need for a running guard.

### Events

A private `_events = mitt<SyncEvents>()` emitter handles event dispatch. The public `events` getter returns `Pick<Emitter<SyncEvents>, 'on' | 'off'>` — callers can subscribe and unsubscribe but cannot emit. This narrows the API at the type level and prevents external code from faking sync events.

### syncOnce Algorithm

`syncOnce()` runs one full sync cycle. The entire body is wrapped in try/catch — it never throws.

**Recipe sync path:**

1. Fetch remote recipe entries via `ctx.client.listRecipes()` → `RecipeEntry[]`
2. Diff against cache via `ctx.cache.diffRecipes(entries)` → `DiffResult` (synchronous)
3. Fetch changed recipes via `ctx.client.getRecipes([...added, ...changed])` — uses internal bulkhead(5)
4. Update cache: `ctx.cache.putRecipe(recipe, hash)` for fetched (sync), `ctx.cache.removeRecipe(uid)` for removed (async)
5. Update store: `ctx.store.set(recipe)` for fetched, `ctx.store.delete(uid)` for removed
6. Partition fetched recipes into `added` vs `updated` based on diff bucket

**Category sync path (replace-all):**

1. Fetch all categories via `ctx.client.listCategories()` → `Category[]` (hydrated)
2. Replace store: `ctx.store.setCategories(categories)`
3. Update cache: `ctx.cache.putCategory(category, category.uid)` for each (uid as placeholder hash)

**Finalization:**

1. Flush cache: `await ctx.cache.flush()` — single call after all mutations
2. Notify MCP clients: `ctx.server.sendResourceListChanged()` if any recipe changes detected
3. Emit `sync:complete` with `SyncResult` — always emitted, even when nothing changed
4. Log via `ctx.server.sendLoggingMessage()` — info on success, error on failure

### Error Handling

On catch: convert to Error if needed, log via `sendLoggingMessage({ level: "error" })`, emit `sync:error`, do not re-throw. The `getRecipes()` call is all-or-nothing (uses `Promise.all` internally) — if any recipe fails, the entire sync cycle errors and retries on the next interval. Per-recipe isolation can be added later if needed.

### Contracts

```typescript
import type { Emitter } from "mitt";

type SyncEvents = {
  "sync:complete": SyncResult;
  "sync:error": Error;
};

class SyncEngine {
  constructor(ctx: ServerContext, intervalMs: number);

  /** Subscribe/unsubscribe only — emit is private. */
  get events(): Pick<Emitter<SyncEvents>, "on" | "off">;

  /** Creates AbortController and enters async loop. No-op if already running. */
  start(): void;

  /** Aborts the controller, breaking the loop. */
  stop(): void;

  /** Runs one full sync cycle. Never throws. Public for testing. */
  syncOnce(): Promise<void>;
}
```

## Existing Patterns

Investigation found these relevant patterns in the codebase:

**DiskCache callback logging** (`src/cache/disk-cache.ts`): DiskCache accepts an optional `log?: (msg: string) => void` callback in its constructor. The sync engine diverges from this pattern — it uses `server.sendLoggingMessage()` instead, which sends diagnostics over the MCP protocol rather than to an opaque callback. This is appropriate because the sync engine has direct access to `ServerContext` (and thus the MCP server), while DiskCache is a lower-level utility without MCP awareness.

**Bulkhead pattern** (`src/paprika/client.ts`): PaprikaClient uses cockatiel bulkheads for concurrency control. The sync engine relies on this rather than reimplementing concurrency limiting.

**RecipeStore bulk operations** (`src/cache/recipe-store.ts`): `store.setCategories()` replaces all categories atomically. The sync engine uses this for category sync rather than individual set/delete operations.

**No existing background process pattern**: This is the first background loop in the codebase. The AbortController + `scheduler.wait()` pattern is new but uses only Node.js built-ins.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: SyncEngine Skeleton and Lifecycle

**Goal:** Create the SyncEngine class with working start/stop lifecycle, AbortController-based loop, and event infrastructure.

**Components:**

- `src/paprika/sync.ts` — SyncEngine class with constructor, start(), stop(), private loop(), events getter. `syncOnce()` is a stub that emits `sync:complete` with an empty `SyncResult`.
- `src/paprika/sync.test.ts` — Lifecycle and events tests

**Dependencies:** None (uses only existing types and mitt)

**Verifies:** p2-u11-sync-engine.AC1 (lifecycle), p2-u11-sync-engine.AC2 (events)

**Done when:** SyncEngine can be constructed, started, stopped. Events are subscribable. Double-start is a no-op. Stop breaks the loop. All lifecycle tests pass.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: syncOnce Implementation — Recipe Sync, Category Sync, and Finalization

**Goal:** Implement the full syncOnce algorithm: recipe diff-and-fetch, category replace-all, cache flush, MCP notification, logging, and error handling.

**Components:**

- `src/paprika/sync.ts` — Replace syncOnce stub with full implementation
- `src/paprika/sync.test.ts` — Sync behavior tests (happy path, empty diff, error resilience, notifications, logging)
- `src/paprika/CLAUDE.md` — Document SyncEngine contract and dependencies

**Dependencies:** Phase 1 (skeleton exists)

**Verifies:** p2-u11-sync-engine.AC3 (recipe sync), p2-u11-sync-engine.AC4 (category sync), p2-u11-sync-engine.AC5 (notifications), p2-u11-sync-engine.AC6 (resilience), p2-u11-sync-engine.AC7 (logging)

**Done when:** Full sync cycle works with mocked dependencies. Recipe changes trigger notifications. Errors are caught, logged, and emitted. Category store is replaced. Cache is flushed once. All tests pass.

<!-- END_PHASE_2 -->

## Additional Considerations

**sendLoggingMessage before connect:** `sendLoggingMessage()` delegates to `server.notification()` which throws `"Not connected"` if the transport isn't attached. Since `start()` fires `syncOnce()` immediately, the first sync may run before `connect()` completes. This is safe because `syncOnce()` wraps everything in try/catch — the error is emitted as `sync:error` and the next cycle retries after the transport is connected.

**Category hash placeholder:** Using `category.uid` as the hash for `cache.putCategory()` means `diffCategories()` would always report categories as "unchanged" (since uid doesn't change). This is fine — we don't use `diffCategories()` for the replace-all approach. The cache entries exist purely for persistence across restarts.

**Future: per-recipe error isolation:** If transient API failures become common, `getRecipes()` could be replaced with individual `getRecipe()` calls wrapped in `Promise.allSettled()` and a custom concurrency limiter. This is explicitly deferred — the current all-or-nothing approach is simpler and the retry-on-next-cycle failure mode is acceptable.
