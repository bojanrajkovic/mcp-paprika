# MCP Resource Registration — Phase 2: Update `commitRecipe` and Its Tests

**Goal:** Add `ctx.server.sendResourceListChanged()` to the `commitRecipe` helper so MCP clients are notified after every CRUD mutation, and update the three existing `commitRecipe` tests to assert on the new call.

**Architecture:** A single synchronous insertion in `helpers.ts` between `ctx.store.set(saved)` and `await ctx.client.notifySync()`. Three test updates in `helpers.test.ts` — the inline server stub in each test gains a `sendResourceListChanged: vi.fn()` mock, and two of the tests gain new assertions on that mock.

**Tech Stack:** TypeScript 5.9, Vitest (`vi.fn()`)

**Scope:** 2 of 3 phases

**Codebase verified:** 2026-03-16

---

## Acceptance Criteria Coverage

### p2-u10-resource-reg.AC3: CRUD mutations notify MCP clients via resource list change

- **p2-u10-resource-reg.AC3.1 Success:** `commitRecipe` calls `ctx.server.sendResourceListChanged()` exactly once per invocation
- **p2-u10-resource-reg.AC3.2 Success:** `sendResourceListChanged()` is called after `ctx.store.set()` — store is up to date when clients are notified
- **p2-u10-resource-reg.AC3.3 Success:** `sendResourceListChanged()` is called before `ctx.client.notifySync()` — notification order is `store.set` → `sendResourceListChanged` → `notifySync`

---

## Key Codebase Facts (verified by investigator)

- `src/tools/helpers.ts` line 98-103: `commitRecipe` current order:
  - line 99: `ctx.cache.putRecipe(saved, saved.hash)` (sync)
  - line 100: `await ctx.cache.flush()` (async)
  - line 101: `ctx.store.set(saved)` (sync)
  - line 102: `await ctx.client.notifySync()` (async)
- `ctx.server.sendResourceListChanged()` is NOT currently called anywhere in production source
- `src/tools/helpers.test.ts` lines 249-319: three `commitRecipe` tests in the suite `"p2-recipe-crud.AC-helpers: commitRecipe"`:
  - AC-helpers.7 (lines 250-270): asserts each of `putRecipe`, `flush`, `store.set`, `notifySync` called exactly once
  - AC-helpers.8 (lines 272-299): asserts call order `["putRecipe", "flush", "storeSet", "notifySync"]` via a `callOrder` array
  - AC-helpers.9 (lines 301-318): asserts `store.set` called with the saved recipe
- All three tests use `server: {} as unknown as ServerContext["server"]` — this must be updated to include `sendResourceListChanged: vi.fn()` so the new call doesn't throw
- `sendResourceListChanged()` returns `void` synchronously — no `await` needed
- **Sequencing note:** Phase 1 is a logical prerequisite (ordered before Phase 2) but NOT a technical dependency for the `helpers.test.ts` changes — those tests construct inline `ctx` objects with their own `sendResourceListChanged: vi.fn()` mock and do not use `makeTestServer()` from Phase 1

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Insert `sendResourceListChanged()` call in `helpers.ts`

**Verifies:** p2-u10-resource-reg.AC3.1, p2-u10-resource-reg.AC3.2, p2-u10-resource-reg.AC3.3

**Files:**

- Modify: `src/tools/helpers.ts` (lines 98-103 — `commitRecipe` function body)

**Implementation:**

Update the comment on line 94 and insert the call between `store.set` and `notifySync`.

Before (lines 90-103):

```typescript
/**
 * Persists a saved recipe to the local cache and store, then triggers cloud sync.
 * Called by all write tools after ctx.client.saveRecipe() returns.
 *
 * Order: putRecipe (sync) → flush (async) → store.set (sync) → notifySync (async)
 * Do NOT call ctx.client.notifySync() separately in the tool handler — commitRecipe
 * already calls it.
 */
export async function commitRecipe(ctx: ServerContext, saved: Recipe): Promise<void> {
  ctx.cache.putRecipe(saved, saved.hash); // sync — buffers to memory
  await ctx.cache.flush(); // async — writes pending entries to disk
  ctx.store.set(saved); // sync — updates in-process store
  await ctx.client.notifySync(); // async — signals Paprika cloud to propagate
}
```

After:

```typescript
/**
 * Persists a saved recipe to the local cache and store, then triggers cloud sync.
 * Called by all write tools after ctx.client.saveRecipe() returns.
 *
 * Order: putRecipe (sync) → flush (async) → store.set (sync) → sendResourceListChanged (sync) → notifySync (async)
 * Do NOT call ctx.client.notifySync() separately in the tool handler — commitRecipe
 * already calls it.
 */
export async function commitRecipe(ctx: ServerContext, saved: Recipe): Promise<void> {
  ctx.cache.putRecipe(saved, saved.hash); // sync — buffers to memory
  await ctx.cache.flush(); // async — writes pending entries to disk
  ctx.store.set(saved); // sync — updates in-process store
  ctx.server.sendResourceListChanged(); // sync — notifies MCP clients to re-list resources
  await ctx.client.notifySync(); // async — signals Paprika cloud to propagate
}
```

**Verification:**

Run: `pnpm typecheck`
Expected: Zero type errors (the method exists on `McpServer`, confirmed by `docs/verified-api.md`)

**Note:** Do NOT run `pnpm test` yet — the existing tests will fail because `server: {}` stub doesn't have `sendResourceListChanged`. Fix the tests in Task 2 first.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Update `helpers.test.ts` — fix server stub and add AC3 assertions

**Verifies:** p2-u10-resource-reg.AC3.1, p2-u10-resource-reg.AC3.2, p2-u10-resource-reg.AC3.3

**Files:**

- Modify: `src/tools/helpers.test.ts` (lines 250-319 — three `commitRecipe` tests)

**Implementation:**

All three `commitRecipe` tests currently have `server: {} as unknown as ServerContext["server"]`. Each needs a `sendResourceListChanged: vi.fn()` mock on the server stub, or the new call in `commitRecipe` will throw `TypeError: ctx.server.sendResourceListChanged is not a function`.

**Test AC-helpers.7** (lines 250-270) — also add AC3.1 assertion:

Before (lines 250-270):

```typescript
it("p2-recipe-crud.AC-helpers.7: calls putRecipe, flush, store.set, and notifySync exactly once each", async () => {
  const mockPutRecipe = vi.fn();
  const mockFlush = vi.fn().mockResolvedValue(undefined);
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockStoreSet = vi.fn();

  const ctx = {
    cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
    client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
    store: { set: mockStoreSet } as unknown as ServerContext["store"],
    server: {} as unknown as ServerContext["server"],
  } satisfies ServerContext;

  const saved = makeRecipe();
  await commitRecipe(ctx, saved);

  expect(mockPutRecipe).toHaveBeenCalledTimes(1);
  expect(mockFlush).toHaveBeenCalledTimes(1);
  expect(mockStoreSet).toHaveBeenCalledTimes(1);
  expect(mockNotifySync).toHaveBeenCalledTimes(1);
});
```

After:

```typescript
it("p2-recipe-crud.AC-helpers.7: calls putRecipe, flush, store.set, sendResourceListChanged, and notifySync exactly once each", async () => {
  const mockPutRecipe = vi.fn();
  const mockFlush = vi.fn().mockResolvedValue(undefined);
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockStoreSet = vi.fn();
  const mockSendResourceListChanged = vi.fn();

  const ctx = {
    cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
    client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
    store: { set: mockStoreSet } as unknown as ServerContext["store"],
    server: { sendResourceListChanged: mockSendResourceListChanged } as unknown as ServerContext["server"],
  } satisfies ServerContext;

  const saved = makeRecipe();
  await commitRecipe(ctx, saved);

  expect(mockPutRecipe).toHaveBeenCalledTimes(1);
  expect(mockFlush).toHaveBeenCalledTimes(1);
  expect(mockStoreSet).toHaveBeenCalledTimes(1);
  expect(mockSendResourceListChanged).toHaveBeenCalledTimes(1);
  expect(mockNotifySync).toHaveBeenCalledTimes(1);
});
```

**Test AC-helpers.8** (lines 272-299) — also add AC3.2 + AC3.3 assertions by extending the `callOrder` expectation:

Before (lines 272-299):

```typescript
it("p2-recipe-crud.AC-helpers.8: putRecipe is called before flush (verify call order)", async () => {
  const callOrder: Array<string> = [];

  const mockPutRecipe = vi.fn(() => {
    callOrder.push("putRecipe");
  });
  const mockFlush = vi.fn(async () => {
    callOrder.push("flush");
  });
  const mockNotifySync = vi.fn(async () => {
    callOrder.push("notifySync");
  });
  const mockStoreSet = vi.fn(() => {
    callOrder.push("storeSet");
  });

  const ctx = {
    cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
    client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
    store: { set: mockStoreSet } as unknown as ServerContext["store"],
    server: {} as unknown as ServerContext["server"],
  } satisfies ServerContext;

  const saved = makeRecipe();
  await commitRecipe(ctx, saved);

  expect(callOrder).toEqual(["putRecipe", "flush", "storeSet", "notifySync"]);
});
```

After:

```typescript
it("p2-recipe-crud.AC-helpers.8: call order is putRecipe → flush → storeSet → sendResourceListChanged → notifySync", async () => {
  const callOrder: Array<string> = [];

  const mockPutRecipe = vi.fn(() => {
    callOrder.push("putRecipe");
  });
  const mockFlush = vi.fn(async () => {
    callOrder.push("flush");
  });
  const mockNotifySync = vi.fn(async () => {
    callOrder.push("notifySync");
  });
  const mockStoreSet = vi.fn(() => {
    callOrder.push("storeSet");
  });
  const mockSendResourceListChanged = vi.fn(() => {
    callOrder.push("sendResourceListChanged");
  });

  const ctx = {
    cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
    client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
    store: { set: mockStoreSet } as unknown as ServerContext["store"],
    server: { sendResourceListChanged: mockSendResourceListChanged } as unknown as ServerContext["server"],
  } satisfies ServerContext;

  const saved = makeRecipe();
  await commitRecipe(ctx, saved);

  expect(callOrder).toEqual(["putRecipe", "flush", "storeSet", "sendResourceListChanged", "notifySync"]);
});
```

**Test AC-helpers.9** (lines 301-318) — fix server stub only (no assertion change needed):

Change only `server: {} as unknown as ServerContext["server"]` to `server: { sendResourceListChanged: vi.fn() } as unknown as ServerContext["server"]`.

**Verification:**

Run: `pnpm test src/tools/helpers.test.ts`
Expected: All tests in `helpers.test.ts` pass, including the three `commitRecipe` tests

Run: `pnpm test`
Expected: All tests pass (no regressions in other tool tests)

**Commit:** `feat(tools): notify MCP clients of resource list changes after commitRecipe`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
