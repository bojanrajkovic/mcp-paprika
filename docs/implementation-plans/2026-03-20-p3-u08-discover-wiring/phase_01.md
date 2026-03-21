# P3-U08 Discover Wiring Implementation Plan

**Goal:** Wire semantic recipe discovery (EmbeddingClient, VectorStore, discover_recipes tool) into the running server lifecycle via a feature module pattern.

**Architecture:** A single `setupDiscoverFeature()` function in `src/features/discover-feature.ts` encapsulates conditional initialization, tool registration, and sync event subscription. `src/index.ts` calls it at the Phase 3 extension point (line 95). When embeddings config is absent, the function returns early — Phase 2 tools are completely unaffected.

**Tech Stack:** TypeScript, vitest, mitt (events), vectra (vector index), cockatiel (resilience)

**Scope:** 1 phase from original design (phase 1 of 1)

**Codebase verified:** 2026-03-20

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p3-u08-discover-wiring.AC1: Feature gating

- **p3-u08-discover-wiring.AC1.1 Success:** When `config.features.embeddings` is configured, `discover_recipes` tool is registered and available
- **p3-u08-discover-wiring.AC1.2 Success:** When `config.features.embeddings` is absent, `discover_recipes` tool is not registered
- **p3-u08-discover-wiring.AC1.3 Success:** Startup logs "Semantic search: enabled" to stderr when embeddings configured
- **p3-u08-discover-wiring.AC1.4 Success:** Startup logs "Semantic search: disabled" to stderr when embeddings not configured

### p3-u08-discover-wiring.AC2: Component initialization

- **p3-u08-discover-wiring.AC2.1 Success:** `EmbeddingClient` is created with the `config.features.embeddings` object
- **p3-u08-discover-wiring.AC2.2 Success:** `VectorStore` is created with `getCacheDir()` and the `EmbeddingClient` instance
- **p3-u08-discover-wiring.AC2.3 Success:** `vectorStore.init()` is awaited before `registerDiscoverTool` is called
- **p3-u08-discover-wiring.AC2.4 Success:** `registerDiscoverTool` is called with `(server, ctx, vectorStore)`

### p3-u08-discover-wiring.AC3: Sync event subscription

- **p3-u08-discover-wiring.AC3.1 Success:** `sync.events.on("sync:complete", ...)` is subscribed before `server.connect(transport)`
- **p3-u08-discover-wiring.AC3.2 Success:** When `sync:complete` fires with added/updated recipes, `vectorStore.indexRecipes()` is called with the changed recipes and a category resolver
- **p3-u08-discover-wiring.AC3.3 Success:** When `sync:complete` fires with `removedUids`, `vectorStore.removeRecipe()` is called for each uid
- **p3-u08-discover-wiring.AC3.4 Edge:** When `sync:complete` fires with no changes (empty added, updated, removedUids), no indexing or removal calls are made

### p3-u08-discover-wiring.AC4: Error isolation

- **p3-u08-discover-wiring.AC4.1 Success:** An exception thrown by `vectorStore.indexRecipes()` in the sync handler is caught and logged to stderr
- **p3-u08-discover-wiring.AC4.2 Success:** An exception thrown by `vectorStore.removeRecipe()` in the sync handler is caught and logged to stderr
- **p3-u08-discover-wiring.AC4.3 Success:** Vector index errors do not propagate to SyncEngine or affect subsequent sync cycles

### p3-u08-discover-wiring.AC5: Non-interference

- **p3-u08-discover-wiring.AC5.1 Success:** `src/paprika/sync.ts` is not modified by this implementation
- **p3-u08-discover-wiring.AC5.2 Success:** All Phase 2 tools continue working correctly when embeddings config is present
- **p3-u08-discover-wiring.AC5.3 Success:** All Phase 2 tools continue working correctly when embeddings config is absent

---

## Context Files

The executor should read these files before starting work. They contain conventions, contracts, and testing patterns needed for implementation:

- `/home/brajkovic/Projects/mcp-paprika/CLAUDE.md` — Project conventions (error handling, testing, imports)
- `/home/brajkovic/Projects/mcp-paprika/src/features/CLAUDE.md` — Feature module contracts (EmbeddingClient, VectorStore signatures)
- `/home/brajkovic/Projects/mcp-paprika/src/tools/CLAUDE.md` — Tool registration patterns and testing utilities
- `/home/brajkovic/Projects/mcp-paprika/src/paprika/CLAUDE.md` — SyncEngine contract and SyncResult type

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

## Subcomponent A: Feature Module and Entry Point Wiring

<!-- START_TASK_1 -->

### Task 1: Create `src/features/discover-feature.ts`

**Verifies:** p3-u08-discover-wiring.AC1.1, p3-u08-discover-wiring.AC1.2, p3-u08-discover-wiring.AC1.3, p3-u08-discover-wiring.AC1.4, p3-u08-discover-wiring.AC2.1, p3-u08-discover-wiring.AC2.2, p3-u08-discover-wiring.AC2.3, p3-u08-discover-wiring.AC2.4, p3-u08-discover-wiring.AC3.1, p3-u08-discover-wiring.AC3.2, p3-u08-discover-wiring.AC3.3, p3-u08-discover-wiring.AC3.4, p3-u08-discover-wiring.AC4.1, p3-u08-discover-wiring.AC4.2, p3-u08-discover-wiring.AC4.3

**Files:**

- Create: `src/features/discover-feature.ts`

**Implementation:**

Create a single exported async function `setupDiscoverFeature` that encapsulates the full discover/embeddings lifecycle. The function takes four dependencies and handles all conditional logic internally.

**Key design decisions:**

- `config.features` may be `undefined` (the `features` field is optional on `PaprikaConfig`). Access via optional chaining: `config.features?.embeddings`.
- The sync event handler is `async` but mitt fires it synchronously (fire-and-forget). The entire handler body must be wrapped in try/catch for error isolation.
- The category resolver delegates to `ctx.store.resolveCategories()`. TypeScript infers the callback parameter type from `VectorStore.indexRecipes`'s second parameter — no need to import `CategoryUid`.
- Logging uses `process.stderr.write()` with `[mcp-paprika]` prefix, matching the existing pattern in `src/index.ts:20-22`.
- The no-op optimization (AC3.4) checks `changed.length === 0 && result.removedUids.length === 0` and returns early.
- **Cold-start initial indexing:** In `src/index.ts`, `await sync.syncOnce()` runs at line 86 and fires `sync:complete` synchronously via mitt — BEFORE `setupDiscoverFeature` subscribes at line 95. On first-ever startup (empty vector index), the initial sync event has already been missed. To handle this, after `vectorStore.init()`, check `vectorStore.size === 0` and if the `RecipeStore` has recipes (`ctx.store.size > 0`), run an explicit initial index: `await vectorStore.indexRecipes(ctx.store.all(), resolveCats)`. On subsequent startups, VectorStore loads its persisted index from disk, so `size > 0` and this step is skipped. This aligns with the design's "No Initial Indexing Required" intent — the vector store is populated on first run, just not via the sync event.

**Dependencies:**

- `EmbeddingClient` from `./embeddings.js` — constructor: `(config: Readonly<EmbeddingConfig>)`
- `VectorStore` from `./vector-store.js` — constructor: `(cacheDir: string, embedder: EmbeddingClient)`, methods: `.init()`, `.indexRecipes(recipes, resolveCats)`, `.removeRecipe(uid)`
- `registerDiscoverTool` from `../tools/discover.js` — signature: `(server, ctx, vectorStore): void`
- `getCacheDir` from `../utils/xdg.js` — returns platform-native cache directory string
- Type imports: `McpServer` from MCP SDK, `ServerContext` from `../types/server-context.js`, `SyncEngine` from `../paprika/sync.js`, `PaprikaConfig` from `../utils/config.js`

```typescript
import { EmbeddingClient } from "./embeddings.js";
import { VectorStore } from "./vector-store.js";
import { registerDiscoverTool } from "../tools/discover.js";
import { getCacheDir } from "../utils/xdg.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../types/server-context.js";
import type { SyncEngine } from "../paprika/sync.js";
import type { PaprikaConfig } from "../utils/config.js";

export async function setupDiscoverFeature(
  server: McpServer,
  ctx: ServerContext,
  sync: SyncEngine,
  config: PaprikaConfig,
): Promise<void> {
  const embeddingsConfig = config.features?.embeddings;

  if (!embeddingsConfig) {
    process.stderr.write("[mcp-paprika] Semantic search: disabled\n");
    return;
  }

  const embedder = new EmbeddingClient(embeddingsConfig);
  const vectorStore = new VectorStore(getCacheDir(), embedder);
  await vectorStore.init();

  registerDiscoverTool(server, ctx, vectorStore);

  // Cold-start initial indexing: the initial sync.syncOnce() in index.ts fires
  // sync:complete BEFORE this subscription exists. On first-ever startup (empty
  // vector index), explicitly index all recipes already in the store.
  if (vectorStore.size === 0 && ctx.store.size > 0) {
    await vectorStore.indexRecipes(ctx.store.getAll(), (uids) => ctx.store.resolveCategories(uids));
  }

  sync.events.on("sync:complete", async (result) => {
    try {
      const changed = [...result.added, ...result.updated];

      if (changed.length === 0 && result.removedUids.length === 0) {
        return;
      }

      if (changed.length > 0) {
        await vectorStore.indexRecipes(changed, (uids) => ctx.store.resolveCategories(uids));
      }

      for (const uid of result.removedUids) {
        await vectorStore.removeRecipe(uid);
      }
    } catch (err) {
      process.stderr.write(`[mcp-paprika] Vector index error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });

  process.stderr.write("[mcp-paprika] Semantic search: enabled\n");
}
```

**Verification:**
Run: `pnpm typecheck`
Expected: No type errors

**Commit:** `feat(discover): add setupDiscoverFeature wiring function`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Wire `setupDiscoverFeature` into `src/index.ts`

**Verifies:** p3-u08-discover-wiring.AC3.1 (subscription happens before `server.connect(transport)` at line 106), p3-u08-discover-wiring.AC5.1 (sync.ts is not modified)

**Files:**

- Modify: `src/index.ts` (add import at top, replace Phase 3 comment)

**Implementation:**

Two changes to `src/index.ts`:

1. **Add import** after the existing tool imports (after `import { registerRecipeResources }` line, before the `import type { ServerContext }` line):

```typescript
import { setupDiscoverFeature } from "./features/discover-feature.js";
```

2. **Replace the `// Phase 3 extension point` comment** (currently line 95, between the sync start/disabled log and the `// 10. Register SIGINT handler` section) with the setup call:

```typescript
// Phase 3: Semantic search
await setupDiscoverFeature(server, ctx, sync, config);
```

This placement ensures:

- `sync` is already created (the `const sync = new SyncEngine(...)` line above)
- Initial sync has completed (`await sync.syncOnce()` above) — first `sync:complete` event already fired
- Subscription happens before `server.connect(transport)` (the `await server.connect(new StdioServerTransport())` line below) — AC3.1

**Important:** Do NOT modify `src/paprika/sync.ts` — AC5.1 requires it stays unchanged. Verify with `git diff src/paprika/sync.ts` showing no output.

**Verification:**
Run: `pnpm typecheck`
Expected: No type errors

Run: `git diff src/paprika/sync.ts`
Expected: No output (file unmodified)

**Commit:** `feat(discover): wire setupDiscoverFeature into server startup`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Verify implementation compiles and existing tests pass

**Verifies:** p3-u08-discover-wiring.AC5.2, p3-u08-discover-wiring.AC5.3

**Files:** None (verification only)

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm test`
Expected: All existing tests pass (Phase 2 tools unaffected)

Run: `pnpm lint`
Expected: No lint warnings or errors

**Why this matters:** AC5.2 and AC5.3 require Phase 2 tools to work regardless of embeddings config. Since tests run without embeddings configured, this verifies the disabled path doesn't break anything.

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

## Subcomponent B: Unit Tests

<!-- START_TASK_4 -->

### Task 4: Create `src/features/discover-feature.test.ts`

**Verifies:** p3-u08-discover-wiring.AC1.1, p3-u08-discover-wiring.AC1.2, p3-u08-discover-wiring.AC1.3, p3-u08-discover-wiring.AC1.4, p3-u08-discover-wiring.AC2.1, p3-u08-discover-wiring.AC2.2, p3-u08-discover-wiring.AC2.3, p3-u08-discover-wiring.AC2.4, p3-u08-discover-wiring.AC3.2, p3-u08-discover-wiring.AC3.3, p3-u08-discover-wiring.AC3.4, p3-u08-discover-wiring.AC4.1, p3-u08-discover-wiring.AC4.2, p3-u08-discover-wiring.AC4.3

**Files:**

- Create: `src/features/discover-feature.test.ts` (unit)

**Testing:**

Use `vi.mock()` to mock the three dependencies (`./embeddings.js`, `./vector-store.js`, `../tools/discover.js`) and `../utils/xdg.js`. This lets you verify initialization order, call arguments, and event handler behavior without real network or file I/O.

**Mocking strategy:**

- `EmbeddingClient` constructor: mock class, capture constructor args via `vi.fn()`
- `VectorStore` constructor: mock class with `.init()`, `.indexRecipes()`, `.removeRecipe()` as `vi.fn()` returning resolved promises
- `registerDiscoverTool`: mock function, capture call args
- `getCacheDir`: mock to return a fixed path like `"/mock/cache"`
- `process.stderr.write`: spy with `vi.spyOn(process.stderr, "write")` to verify log messages
- `sync.events`: create a real mitt emitter (or manual `on`/`off` object) so tests can fire `sync:complete` events and observe handler behavior

**Config fixtures:**

- Enabled config: `{ paprika: {...}, sync: {...}, features: { embeddings: { apiKey: "k", baseUrl: "http://localhost", model: "m" } } }`
- Disabled config (features undefined): `{ paprika: {...}, sync: {...} }` — `features` field omitted
- Disabled config (embeddings undefined): `{ paprika: {...}, sync: {...}, features: {} }` — `features` present but no `embeddings`

**Test structure:** Follow project convention with describe blocks named by AC identifier and test names prefixed with AC case numbers.

Tests must verify each AC listed above:

**AC1: Feature gating**

- p3-u08-discover-wiring.AC1.1: Call with embeddings config → verify `registerDiscoverTool` was called (tool registered)
- p3-u08-discover-wiring.AC1.2: Call without embeddings config → verify `registerDiscoverTool` was NOT called
- p3-u08-discover-wiring.AC1.3: Call with embeddings config → verify stderr contains "Semantic search: enabled"
- p3-u08-discover-wiring.AC1.4: Call without embeddings config → verify stderr contains "Semantic search: disabled"

**AC2: Component initialization**

- p3-u08-discover-wiring.AC2.1: Verify `EmbeddingClient` constructor received the `config.features.embeddings` object
- p3-u08-discover-wiring.AC2.2: Verify `VectorStore` constructor received `"/mock/cache"` (from mocked getCacheDir) and the `EmbeddingClient` instance
- p3-u08-discover-wiring.AC2.3: Verify `vectorStore.init()` was called, and that `registerDiscoverTool` was called after (use mock call order tracking or separate assertions)
- p3-u08-discover-wiring.AC2.4: Verify `registerDiscoverTool` was called with `(server, ctx, vectorStore)` — the exact arguments

**AC2 (additional): Cold-start initial indexing**

- When `vectorStore.size === 0` and `ctx.store.size > 0`, verify `vectorStore.indexRecipes()` is called with all recipes from `ctx.store.getAll()` during setup (before any sync events)
- When `vectorStore.size > 0` (persisted index loaded), verify no initial indexing call is made

**AC3: Sync event subscription**

- p3-u08-discover-wiring.AC3.2: Fire `sync:complete` with `{ added: [recipe1], updated: [recipe2], removedUids: [] }` → verify `vectorStore.indexRecipes()` called with `[recipe1, recipe2]` and a function (the category resolver)
- p3-u08-discover-wiring.AC3.3: Fire `sync:complete` with `{ added: [], updated: [], removedUids: ["uid1", "uid2"] }` → verify `vectorStore.removeRecipe()` called twice with "uid1" and "uid2"
- p3-u08-discover-wiring.AC3.4: Fire `sync:complete` with `{ added: [], updated: [], removedUids: [] }` → verify neither `indexRecipes` nor `removeRecipe` was called

**AC4: Error isolation**

- p3-u08-discover-wiring.AC4.1: Make `vectorStore.indexRecipes()` throw → fire sync event → verify error logged to stderr, no exception propagated
- p3-u08-discover-wiring.AC4.2: Make `vectorStore.removeRecipe()` throw → fire sync event → verify error logged to stderr, no exception propagated
- p3-u08-discover-wiring.AC4.3: After an error in the handler, fire another sync event → verify handler runs again successfully (errors don't break subsequent cycles)

**Important testing notes:**

- The sync handler is async but mitt fires it synchronously. After emitting `sync:complete`, you need to `await` the handler's promise. Capture the handler reference via the mock emitter's `on` call, then await the result of calling it directly — or use `await vi.waitFor()` / `await new Promise(r => setTimeout(r, 0))` to let the microtask queue flush.
- Use `makeRecipe()` from `src/cache/__fixtures__/recipes.js` to create test recipe objects for the sync result payload.
- Reference existing test patterns in `src/tools/discover.test.ts` (VectorStore mock pattern) and `src/paprika/sync.test.ts` (event-driven mock factories).

**Verification:**
Run: `pnpm test src/features/discover-feature.test.ts`
Expected: All tests pass

**Commit:** `test(discover): add unit tests for setupDiscoverFeature`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: Verify all tests pass and lint clean

**Verifies:** p3-u08-discover-wiring.AC5.2, p3-u08-discover-wiring.AC5.3

**Files:** None (verification only)

**Verification:**

Run: `pnpm test`
Expected: All tests pass (new + existing)

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm typecheck`
Expected: No type errors

Run: `git diff src/paprika/sync.ts`
Expected: No output (AC5.1 — sync.ts unmodified)

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

## Subcomponent C: Integration Test (requires Ollama)

<!-- START_TASK_6 -->

### Task 6: Create `src/features/discover-feature.test.integration.ts`

**Verifies:** p3-u08-discover-wiring.AC2.1, p3-u08-discover-wiring.AC2.2, p3-u08-discover-wiring.AC2.3, p3-u08-discover-wiring.AC3.2, p3-u08-discover-wiring.AC3.3

**Files:**

- Create: `src/features/discover-feature.test.integration.ts` (integration)

**Testing:**

This test exercises the real initialization pipeline: `EmbeddingClient` → `VectorStore` → `registerDiscoverTool` → sync event handler. It requires a running Ollama instance with a text embedding model (e.g., `nomic-embed-text`).

**Strategy:**

- Use a real `EmbeddingClient` pointing to local Ollama (`http://localhost:11434/v1`)
- Use a real `VectorStore` in a temp directory (clean up in `afterEach`)
- Use a stub `McpServer` from `makeTestServer()` in `src/tools/tool-test-utils.ts`
- Use a real `RecipeStore` loaded with test recipes
- **Sync event triggering:** `setupDiscoverFeature` accepts a `SyncEngine` and subscribes to its `.events` property. For the integration test, construct a mock `SyncEngine`-compatible object whose `events` property is backed by a real mitt emitter. This allows the test to emit `sync:complete` events after `setupDiscoverFeature` has subscribed:

```typescript
import mitt from "mitt";
import type { SyncResult } from "../paprika/types.js";

type SyncEvents = { "sync:complete": SyncResult; "sync:error": Error };
const emitter = mitt<SyncEvents>();
const mockSync = { events: emitter } as unknown as SyncEngine;

// After setupDiscoverFeature(server, ctx, mockSync, config):
emitter.emit("sync:complete", { added: [recipe], updated: [], removedUids: [] });
// Then await a microtask flush to let the async handler complete:
await new Promise((r) => setTimeout(r, 50));
```

This follows the same pattern used in `src/paprika/sync.test.ts` (lines 65-92) for event-driven testing.

**Test cases:**

- Verify that `setupDiscoverFeature` completes without error when Ollama is available
- Verify that the `discover_recipes` tool is registered (can be called via `callTool`)
- Fire a simulated `sync:complete` with added recipes → verify `vectorStore.size` increases
- Fire a simulated `sync:complete` with removedUids → verify `vectorStore.size` decreases
- Verify the registered tool returns results after indexing

**Important:**

- Follow the pattern in `src/features/vector-store.test.integration.ts` for temp directory setup/teardown
- Use `describe.skipIf` or check for Ollama availability to skip gracefully when Ollama is not running
- Reference `src/features/embeddings-vector-store.test.integration.ts` for the full pipeline integration test pattern

**Verification:**
Run: `pnpm test src/features/discover-feature.test.integration.ts`
Expected: Tests pass (or skip if Ollama unavailable)

**Commit:** `test(discover): add integration test for setupDiscoverFeature`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->

### Task 7: Final verification

**Verifies:** p3-u08-discover-wiring.AC5.1, p3-u08-discover-wiring.AC5.2, p3-u08-discover-wiring.AC5.3

**Files:** None (verification only)

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm test`
Expected: All tests pass

Run: `pnpm lint`
Expected: No warnings or errors

Run: `git diff src/paprika/sync.ts`
Expected: No output (AC5.1 confirmed)

Run: `git diff --stat`
Expected: Only these files changed/created:

- `src/features/discover-feature.ts` (new)
- `src/features/discover-feature.test.ts` (new)
- `src/features/discover-feature.test.integration.ts` (new)
- `src/index.ts` (modified — import + Phase 3 call)
<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->
