# Pantry Read Support Design

## Summary

This document describes adding read-only access to Paprika's pantry feature in mcp-paprika. Paprika allows users to track pantry inventory — ingredients they have on hand, with quantities, expiration dates, and aisle assignments. This feature exposes that data to MCP clients through two tools (`list_pantry` and `get_pantry_item`) and a browsable resource template (`paprika://pantry/{uid}`).

The implementation follows the same layered architecture already established for recipes: a Zod-validated API client method fetches pantry items from the Paprika cloud API, an in-memory store provides fast querying (including tiered fuzzy ingredient search), a disk cache provides persistence across restarts, and the sync engine keeps everything fresh in the background. The one meaningful divergence from the recipe pattern is that pantry items have no `hash` field, so sync uses a replace-all strategy rather than diffing — the same approach already used for categories. A separate `hasSynced` flag on `PantryStore` replaces the `size === 0` heuristic used for recipes, because an empty pantry is a legitimate user state rather than an indicator that sync hasn't run yet.

## Definition of Done

Add read-only pantry support to mcp-paprika, following the established recipe architecture pattern. This includes Zod types for pantry items (wire and stored schemas with branded UID), a `PaprikaClient.listPantry()` method for the GET `/sync/pantry/` endpoint, a `PantryStore` in-memory query layer with fuzzy ingredient search, `DiskCache` extensions for pantry persistence using a replace-all sync strategy (no hash field), `SyncEngine` integration for background pantry refresh, a `pantryStore` field on `ServerContext`, two MCP tools (`list_pantry` returning a markdown table, `get_pantry_item` with UID or fuzzy ingredient lookup), a `paprika://pantry/{uid}` MCP resource template, and unit tests for all new code. All of `pnpm build`, `pnpm test`, `pnpm typecheck`, and `pnpm lint` must pass.

Write support (`add_pantry_item`, `update_pantry_item`, `delete_pantry_item`) is explicitly deferred to a separate design plan and PR.

## Acceptance Criteria

### pantry-read.AC1: Types and Client
- **pantry-read.AC1.1 Success:** Snake_case wire JSON parsed through `PantryItemSchema` produces camelCase `PantryItem` with all fields correctly transformed
- **pantry-read.AC1.2 Success:** CamelCase JSON validates through `PantryItemStoredSchema` without transformation (disk round-trip)
- **pantry-read.AC1.3 Success:** `PantryItemUidSchema` produces branded `PantryItemUid` type
- **pantry-read.AC1.4 Success:** `expirationDate` as `null` passes validation in both schemas
- **pantry-read.AC1.5 Success:** `listPantry()` returns parsed `Array<PantryItem>` from API response
- **pantry-read.AC1.6 Success:** `listPantry()` returns empty array when account has no pantry items
- **pantry-read.AC1.7 Failure:** Malformed wire JSON rejected by `PantryItemSchema` (missing required field)

### pantry-read.AC2: PantryStore
- **pantry-read.AC2.1 Success:** `load()` populates store and sets `hasSynced` to `true`
- **pantry-read.AC2.2 Success:** `load()` with empty array sets `hasSynced` to `true` (empty pantry is valid)
- **pantry-read.AC2.3 Success:** `get(uid)` returns item for known UID, `undefined` for unknown
- **pantry-read.AC2.4 Success:** `getAll()` returns all loaded items (no filtering)
- **pantry-read.AC2.5 Success:** `set()` upserts, `delete()` removes, `size` reflects changes
- **pantry-read.AC2.6 Success:** `findByIngredient` exact match takes priority over startsWith
- **pantry-read.AC2.7 Success:** `findByIngredient` startsWith takes priority over includes
- **pantry-read.AC2.8 Success:** `findByIngredient` is case-insensitive
- **pantry-read.AC2.9 Edge:** `findByIngredient` returns empty array when no match
- **pantry-read.AC2.10 Edge:** `hasSynced` is `false` before any `load()` call

### pantry-read.AC3: DiskCache Extensions
- **pantry-read.AC3.1 Success:** `init()` creates `pantry/` subdirectory
- **pantry-read.AC3.2 Success:** `putPantryItem()` + `flush()` writes JSON file to `pantry/` directory
- **pantry-read.AC3.3 Success:** `getAllPantryItems()` returns items from pending buffer and disk, pending shadows disk
- **pantry-read.AC3.4 Success:** `removePantryItem()` deletes file and removes from index and pending
- **pantry-read.AC3.5 Edge:** `removePantryItem()` is idempotent on missing file
- **pantry-read.AC3.6 Edge:** Existing `index.json` without `pantry` key loads cleanly via `.default({})`

### pantry-read.AC4: Sync Engine Integration
- **pantry-read.AC4.1 Success:** `syncOnce()` populates `PantryStore` via `load()` with items from API
- **pantry-read.AC4.2 Success:** `syncOnce()` writes all pantry items to `DiskCache`
- **pantry-read.AC4.3 Success:** Orphan pantry files (cached but not in API response) are removed from disk and index
- **pantry-read.AC4.4 Success:** `sendResourceListChanged()` called when pantry set changes
- **pantry-read.AC4.5 Success:** `pantryStore.hasSynced` is `true` after `syncOnce()` completes
- **pantry-read.AC4.6 Edge:** Empty pantry from API handled gracefully (store loaded, `hasSynced` true, no errors)
- **pantry-read.AC4.7 Failure:** `syncOnce()` does not throw when `listPantry()` fails (error logged and emitted)

### pantry-read.AC5: Read Tools
- **pantry-read.AC5.1 Success:** `list_pantry` returns markdown table sorted alphabetically by ingredient
- **pantry-read.AC5.2 Success:** `list_pantry` returns friendly message for empty pantry
- **pantry-read.AC5.3 Success:** `get_pantry_item` by UID returns full item details as markdown
- **pantry-read.AC5.4 Success:** `get_pantry_item` by ingredient with single fuzzy match returns item details
- **pantry-read.AC5.5 Success:** `get_pantry_item` by ingredient with multiple matches returns disambiguation list
- **pantry-read.AC5.6 Failure:** `get_pantry_item` with unknown UID or ingredient returns not-found message
- **pantry-read.AC5.7 Failure:** Both tools return error when `pantryStore.hasSynced` is `false` (cold start guard)
- **pantry-read.AC5.8 Failure:** `get_pantry_item` with neither `uid` nor `ingredient` is rejected by input validation

### pantry-read.AC6: MCP Resource
- **pantry-read.AC6.1 Success:** List callback returns all pantry items with URI, name, and mimeType
- **pantry-read.AC6.2 Success:** Read callback returns pantry item formatted as markdown for known UID
- **pantry-read.AC6.3 Failure:** Read callback throws for unknown UID

## Glossary

- **Branded type / branded UID**: A TypeScript nominal typing pattern that makes a `string` incompatible with other strings at compile time, preventing UIDs of one entity type from being accidentally passed where another is expected.
- **Cold start guard / `pantryStartGuard`**: A check that prevents tool calls from returning stale or misleading results before the first sync has completed. Returns an error to the caller if `hasSynced` is `false`.
- **`CacheIndexSchema`**: The Zod schema for the on-disk `index.json` file that tracks which items are cached. Extended with a `pantry` field using `.default({})` so existing index files without the field load without error.
- **MCP (Model Context Protocol)**: An open protocol for exposing tools and resources to AI assistants. This server implements MCP over stdio.
- **MCP resource / resource template**: A URI-addressable piece of data exposed to MCP clients. A resource template (e.g. `paprika://pantry/{uid}`) is a parameterized pattern that generates individual resources.
- **MCP tool**: A callable function exposed to MCP clients, analogous to an API endpoint. Tools have input schemas and return structured or text responses.
- **msw (Mock Service Worker)**: The HTTP mocking library used in tests to intercept `fetch` calls and return fixture responses without making real network requests.
- **neverthrow `Result<T, E>`**: A type-safe alternative to thrown exceptions. Functions return `Result.ok(value)` or `Result.err(error)`; callers handle both cases via `.match()` or `.andThen()`.
- **Orphan cleanup**: Removing cached files on disk that are no longer present in the API response, preventing stale data from accumulating between syncs.
- **Pending write buffer**: An in-memory Map (`_pendingPantryItems`) that accumulates writes and is drained to disk on `flush()`, reducing individual filesystem operations during sync.
- **Replace-all sync**: A sync strategy where the full list of items is fetched from the API and replaces the local state wholesale, as opposed to a diff-and-fetch strategy that compares hashes to determine which items changed.
- **Tiered fuzzy search**: The `findByIngredient` matching strategy: exact match takes priority over prefix (startsWith) match, which takes priority over substring (includes) match. All comparisons are case-insensitive.
- **Wire format / wire schema**: The JSON shape as received from the API — typically snake_case field names. Contrasted with the stored format (camelCase) used internally.

## Architecture

Pantry read support mirrors the existing recipe architecture: API data flows through a typed client into an in-memory store backed by disk cache, kept fresh by the sync engine, and queried by MCP tools and resources.

**Data flow:**

```
Paprika API ──GET /sync/pantry/──> PaprikaClient.listPantry()
  ──z.array(PantryItemSchema)──> Array<PantryItem> (camelCase)
  ──SyncEngine.syncOnce()──> PantryStore.load() + DiskCache.putPantryItem()
  ──tool handler──> PantryStore.getAll() / .get() / .findByIngredient()
  ──resource handler──> PantryStore.get()
```

**Key components:**

- **`PantryItemSchema` / `PantryItemStoredSchema`** (`src/paprika/types.ts`) — Zod schemas for wire (snake_case) and stored (camelCase) formats. Branded `PantryItemUid` type.
- **`PaprikaClient.listPantry()`** (`src/paprika/client.ts`) — GET request returning full pantry item objects. No entry/detail split (unlike recipes).
- **`PantryStore`** (`src/cache/pantry-store.ts`) — In-memory Map with CRUD, `hasSynced` cold start flag, and tiered fuzzy `findByIngredient` search.
- **`DiskCache` extensions** (`src/cache/disk-cache.ts`) — `pantry/` subdirectory, pending write buffer, orphan removal. `CacheIndexSchema` extended with `pantry: z.record().default({})` for backwards compatibility.
- **`SyncEngine` pantry path** (`src/paprika/sync.ts`) — Replace-all sync (no hash field). Fetches full list, loads store, computes and removes orphan disk files, writes incoming items to cache.
- **`pantryStartGuard`** (`src/tools/pantry-helpers.ts`) — Checks `ctx.pantryStore.hasSynced`. Separate from recipe `coldStartGuard` because an empty pantry is legitimate (unlike an empty recipe store which indicates sync hasn't run).
- **`list_pantry` / `get_pantry_item`** (`src/tools/pantry-list.ts`, `src/tools/pantry-get.ts`) — Read tools backed by `PantryStore`.
- **`paprika://pantry/{uid}`** (`src/resources/pantry.ts`) — MCP resource template with list and read callbacks.

**Pantry-specific constraints:**

- No `hash` field on pantry items — sync uses replace-all strategy (same as categories), not diff-and-fetch (like recipes).
- No per-item GET endpoint confirmed — `listPantry()` fetches the entire list. Individual item lookup happens in-memory via `PantryStore`.
- `aisle` and `aisle_uid` are opaque strings — no aisle lookup or management.

## Existing Patterns

This design follows established patterns found in the codebase:

**Dual Zod schema pattern** (`src/paprika/types.ts`): `RecipeSchema` (wire, snake_case with `.transform()`) and `RecipeStoredSchema` (disk, camelCase, no transform) with branded UID. Pantry types follow this exactly.

**Client request pattern** (`src/paprika/client.ts`): `listRecipes()` calls `this.request("GET", url, schema)` with Zod validation on the response envelope. `listPantry()` follows the same signature.

**In-memory store pattern** (`src/cache/recipe-store.ts`): `RecipeStore` uses a `Map<RecipeUid, Recipe>` with `load()`, `get()`, `getAll()`, `set()`, `delete()`, `size`. `PantryStore` mirrors this interface. Divergence: `PantryStore` adds `hasSynced` flag (recipes use `size === 0` heuristic which doesn't work for legitimately-empty pantries).

**DiskCache pending buffer pattern** (`src/cache/disk-cache.ts`): `_pendingRecipes` Map buffers writes until `flush()`. Pantry adds `_pendingPantryItems` following the same pattern. The `CacheIndexSchema` uses `.default({})` for backwards compatibility (same approach that would be used if categories were added after initial release).

**Replace-all sync** (`src/paprika/sync.ts:95-102`): Category sync fetches all, replaces store, writes to cache. Pantry follows this but adds orphan cleanup (categories don't track orphans because there's no `removeCategory()` or `getAllCategories()`).

**Tool registration pattern** (`src/tools/*.ts`): `registerXTool(server, ctx)` with `coldStartGuard(ctx).match()`. Pantry tools follow this but use `pantryStartGuard` instead.

**Resource template pattern** (`src/resources/recipes.ts`): `ResourceTemplate` with `list` callback and read handler. Pantry resource follows this exactly.

**Test patterns:** Sync tests use pure `vi.fn()` mocks (no HTTP). Tool tests use `makeTestServer()` + `makeCtx()`. DiskCache tests use real temp filesystem. Pantry tests follow all three patterns.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Types and Client

**Goal:** Define pantry item types and add the API read method.

**Components:**
- `PantryItemUidSchema`, `PantryItemStoredSchema`, `PantryItemSchema`, `PantryItem` type in `src/paprika/types.ts`
- `PaprikaClient.listPantry()` in `src/paprika/client.ts`
- `makePantryItem()` test fixture in `src/cache/__fixtures__/pantry.ts`
- Type transform tests in `src/paprika/types.test.ts`
- Client tests in `src/paprika/client.test.ts` (msw handler for GET `/sync/pantry/`)

**Dependencies:** None (first phase)

**Done when:** Wire→stored transform works, `listPantry()` parses mock API responses, `pnpm build` and `pnpm test` pass. Covers `pantry-read.AC1.*`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: PantryStore

**Goal:** In-memory query layer for pantry items with cold start detection.

**Components:**
- `PantryStore` class in `src/cache/pantry-store.ts` — `load()`, `get()`, `getAll()`, `set()`, `delete()`, `size`, `hasSynced`, `findByIngredient()`
- Tests in `src/cache/pantry-store.test.ts`

**Dependencies:** Phase 1 (uses `PantryItem` and `PantryItemUid` types)

**Done when:** All CRUD operations work, `hasSynced` flag behaves correctly, `findByIngredient` returns correct tier results (exact > startsWith > includes), `pnpm build` and `pnpm test` pass. Covers `pantry-read.AC2.*`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: DiskCache Extensions

**Goal:** Persistent storage for pantry items with backwards-compatible index.

**Components:**
- `CacheIndexSchema` extended with `pantry` field in `src/cache/disk-cache.ts`
- `_pantryDir` subdirectory and `_pendingPantryItems` buffer in `DiskCache`
- `putPantryItem()`, `removePantryItem()`, `getAllPantryItems()` methods in `DiskCache`
- `flush()` extended to drain pantry pending buffer
- `init()` extended to create `pantry/` subdirectory
- Tests extending `src/cache/disk-cache.test.ts`

**Dependencies:** Phase 1 (uses `PantryItem` type and `PantryItemStoredSchema`)

**Done when:** Pantry items persist to disk, pending buffer shadows disk reads, orphan removal works, existing `index.json` without `pantry` key loads cleanly, `pnpm build` and `pnpm test` pass. Covers `pantry-read.AC3.*`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Sync Engine, ServerContext, and Index Wiring

**Goal:** Connect pantry sync to the background refresh loop and wire everything together.

**Components:**
- Pantry sync path in `SyncEngine.syncOnce()` in `src/paprika/sync.ts` — replace-all with orphan cleanup
- `pantryStore: PantryStore` field added to `ServerContext` in `src/types/server-context.ts`
- `PantryStore` instantiation and hydration in `src/index.ts`
- `sendResourceListChanged()` condition broadened to include pantry changes
- Sync tests extended in `src/paprika/sync.test.ts`

**Dependencies:** Phases 1-3 (client, store, cache all required)

**Done when:** `syncOnce()` populates `PantryStore` and `DiskCache` with pantry items, orphan files are cleaned up, `sendResourceListChanged()` fires on pantry changes, `pantryStore.hasSynced` is `true` after sync, `pnpm build` and `pnpm test` pass. Covers `pantry-read.AC4.*`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Read Tools

**Goal:** MCP tools for listing and looking up pantry items.

**Components:**
- `pantryStartGuard()` and `pantryItemToMarkdown()` in `src/tools/pantry-helpers.ts`
- `registerListPantryTool()` in `src/tools/pantry-list.ts`
- `registerGetPantryItemTool()` in `src/tools/pantry-get.ts`
- Tool registration in `src/index.ts`
- Tests in `src/tools/pantry-list.test.ts` and `src/tools/pantry-get.test.ts`

**Dependencies:** Phases 2 and 4 (PantryStore and ServerContext wiring)

**Done when:** `list_pantry` returns sorted markdown table, `get_pantry_item` finds by UID or fuzzy ingredient name with disambiguation, `pantryStartGuard` blocks calls before sync, `pnpm build` and `pnpm test` pass. Covers `pantry-read.AC5.*`.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: MCP Resource

**Goal:** Expose pantry items as browsable MCP resources.

**Components:**
- `registerPantryResources()` in `src/resources/pantry.ts`
- Resource registration in `src/index.ts`
- Tests in `src/resources/pantry.test.ts`

**Dependencies:** Phase 4 (ServerContext with pantryStore)

**Done when:** `paprika://pantry/{uid}` lists all pantry items and returns individual item details by UID, `pnpm build` and `pnpm test` pass. Covers `pantry-read.AC6.*`.
<!-- END_PHASE_6 -->

## Additional Considerations

**Backwards compatibility:** The `CacheIndexSchema` change uses `.default({})` for the `pantry` field. Existing users upgrading will have `index.json` files without a `pantry` key — Zod handles this at parse time with no migration needed.

**Write support deferred:** `add_pantry_item`, `update_pantry_item`, and `delete_pantry_item` are scoped to a separate design plan and PR. The `PantryStore.set()` and `DiskCache.putPantryItem()` methods exist in this PR (needed for sync) but are not exposed through tools yet.

**Sync notification refactoring:** Issue [#45](https://github.com/bojanrajkovic/mcp-paprika/issues/45) tracks unifying `sync:complete` and `sendResourceListChanged()` into a single event-driven notification mechanism. This PR uses direct `sendResourceListChanged()` calls as a pragmatic interim approach.

**No `pantryItemToApiPayload()`:** The camelCase→snake_case converter is only needed for write operations. Deferred to the write support PR.

## Documents to Update

| Document | Change |
|----------|--------|
| `CLAUDE.md` (root) | Add pantry tools and resource to project structure |
| `src/paprika/CLAUDE.md` | Add `PantryItem` types, `listPantry()` client method, pantry sync path |
| `src/cache/CLAUDE.md` | Add `PantryStore` contract, `DiskCache` pantry methods |
| `src/tools/CLAUDE.md` | Add `list_pantry` and `get_pantry_item` tool entries, `pantryStartGuard` helper |
| `src/resources/CLAUDE.md` | Add `paprika://pantry/{uid}` resource |
| `src/types/CLAUDE.md` | Add `pantryStore` field to `ServerContext` |
