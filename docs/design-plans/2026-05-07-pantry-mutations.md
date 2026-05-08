# Pantry Write Support Design

> **Wire format note (2026-05-08):** The originally-designed wire format
> ("mirrors `saveRecipe` exactly") was inferred from community libraries that
> don't actually implement pantry writes. Empirical capture from the macOS
> Paprika.app v3.8.4 (build:41) via mitmproxy revealed two divergences from
> the recipe write path:
>
> 1. **URL is the collection** `POST /api/v2/sync/pantry/` (NO UID in path).
>    Recipe writes use `/sync/recipe/{uid}/`; pantry, grocery aisles, grocery
>    ingredients, and grocery lists all share the no-UID-in-path collection
>    pattern. Recipe is the outlier (probably because recipes carry photos
>    that warrant per-item upload endpoints).
> 2. **Body is a JSON array** `[item]` (a single-element array even for one
>    item; Paprika.app batches when multiple changes happen quickly).
> 3. **Multipart filename** is `"file"` (not `"data.gz"`).
> 4. **Date format** for `purchase_date` and `expiration_date` is plain
>    `"yyyy-MM-dd HH:mm:ss"` (no T, no timezone, no fractional seconds; the
>    time component is conventionally `00:00:00`). ISO 8601 is rejected with
>    HTTP 500. See `src/paprika/dates.ts`.
> 5. **`has_expiration` is NOT auto-derived from `expiration_date` on the
>    wire** — Paprika.app permits these to disagree. Our MCP tool still
>    auto-derives them in `add_pantry_item`/`update_pantry_item` for tool-level
>    convenience; that behavior is a tool contract, not an API contract.
> 6. **`aisle_uid` is a 64-char uppercase hex string**, NOT a UUID. It
>    references Paprika's aisle catalog. An empty string is accepted by the
>    server (verified — issue #56's contingency does NOT apply).
>
> The text below was the original plan. The "Pantry write wire format" section
> later in this doc and `src/paprika/CLAUDE.md` carry the corrected contract.

## Summary

Pantry write support builds on the read infrastructure shipped in PR #46, adding three MCP tools — `add_pantry_item`, `update_pantry_item`, and `delete_pantry_item` — along with the client method, payload converter, and commit helper that back them. The implementation mirrors the recipe write path at the helper-orchestration layer (`commitPantryItem` matches `commitRecipe`'s ordering) but the WIRE FORMAT diverges (see the wire-format note above): the URL is the pantry collection (no UID in path), the body is a `[item]` array, and dates use Paprika's plain `yyyy-MM-dd HH:mm:ss` format. `pantryItemToApiPayload` is a camelCase-to-snake_case converter parallel to `recipeToApiPayload`. Soft-delete is expressed by setting `deleted: true` on the item and posting through the same endpoint — there is no separate DELETE method.

Two aspects diverge intentionally from the recipe pattern. First, the `deleted` field is declared `optional().default(false)` on both pantry schemas rather than required, because community implementations do not confirm that the Paprika API includes `deleted` on read responses for live items; the default makes parsing absent-tolerant while the TypeScript type still sees a non-optional `boolean` everywhere else. Second, `add_pantry_item` rejects duplicate ingredient names via a case-insensitive exact match against the store before generating a UID, returning the existing item's UID in the rejection message so the caller can switch to `update_pantry_item` — a guard that has no recipe equivalent. Because the pantry write wire format is inferred from community implementations rather than confirmed by official documentation, a `scripts/smoke-pantry-write.ts` runner provides manual empirical validation against a real Paprika account before merge, and its output serves as the PR's evidence artifact.

## Definition of Done

Add write support for the Paprika pantry to mcp-paprika, building on the read infrastructure delivered in PR #46. The implementation follows the recipe write pattern: a Zod-validated `PaprikaClient.savePantryItem()` method (gzip/multipart POST, mirroring `saveRecipe`), a `pantryItemToApiPayload()` camelCase→snake_case converter, and a `commitPantryItem(ctx, saved)` helper that mirrors `commitRecipe` (cache.putPantryItem → cache.flush → pantryStore.set → server.sendResourceListChanged → client.notifySync).

Whether a separate delete-oriented client method ships is conditional on the tool-surface choice. If brainstorming converges on a dedicated delete tool backed by a hard DELETE endpoint or a wire form distinct from `savePantryItem()`, a dedicated client method ships alongside it. If the chosen surface implements deletion via `savePantryItem()` with a flag (e.g., `inStock=false` or a soft-delete equivalent), no extra client method is needed. Brainstorming research against the community implementations (paprika-rs, kappari, go-paprika) determines which path applies.

Three MCP tool registrations: `add_pantry_item` (constructs a complete `PantryItem` from user input + sensible defaults), `update_pantry_item` (partial merge mirroring `update_recipe` — only provided fields change, fetched-from-store baseline), and a delete-tool surface whose shape (single `delete_pantry_item`, no delete tool, or split `delete_pantry_item` + `mark_out_of_stock`) is decided during brainstorming once the wire form and ergonomic constraints are clear.

A `scripts/smoke-pantry-write.ts` runner provides manual validation against a real Paprika account before merge. The runner performs (1) cleanup of any leftover items from prior runs (identified by a known prefix on the ingredient name, e.g. `[mcp-smoke]`), (2) a happy-path round-trip exercising add → list → update → delete, and (3) deliberate failure-mode probes (update non-existent UID, double-delete, invalid input) to confirm error paths behave correctly against the live API. Output is suitable for pasting into the PR comment.

Unit tests cover the new client method (msw-mocked HTTP), the payload converter, the commit helper, and each tool handler (using the established `makeTestServer` + `makeCtx` pattern). New code achieves ≥ 70% coverage. CLAUDE.md updates land alongside the implementation per a "Documents to Update" table populated in this design. All quality gates (`pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`) pass.

**Explicitly out of scope:**

- Issue [#45](https://github.com/bojanrajkovic/mcp-paprika/issues/45) (sync-notification unification) stays deferred — pantry writes use the existing `sendResourceListChanged()` + `notifySync()` interim approach.
- Write→sync propagation race tracked in [#57](https://github.com/bojanrajkovic/mcp-paprika/issues/57). This race already exists for recipe writes (`cache.diffRecipes` flags just-written items as `removed` if sync fires before server propagation) and the same mechanism applies to pantry writes (orphan cleanup deletes them). This PR ships with the same race profile recipes have today; the linked follow-up addresses both at once.
- Aisle/location semantics investigation tracked in [#56](https://github.com/bojanrajkovic/mcp-paprika/issues/56). This design treats `aisle`, `aisleUid`, and `locationUid` as opaque pass-through strings; `add_pantry_item` defaults both aisle fields to empty strings when the caller does not supply them. **Contingency:** if the smoke test reveals Paprika rejects pantry-item writes with empty `aisle`/`aisle_uid`, the deliverables in #56 (aisle client method, store, sync, `list_aisles` tool, name→UID resolution helper) become a hard prerequisite for this PR and must land first.
- Changes to existing read tools, the read sync path, or the `paprika://pantry/{uid}` resource.

## Acceptance Criteria

### pantry-mutations.AC1: Schema and payload converter

- **pantry-mutations.AC1.1 Success:** A `PantryItem` with `deleted: false` round-trips through `PantryItemSchema` (snake_case wire) without loss
- **pantry-mutations.AC1.2 Success:** Wire JSON without a `deleted` key parses through `PantryItemSchema` and yields `deleted: false` (the schema default)
- **pantry-mutations.AC1.3 Success:** Stored JSON without a `deleted` key parses through `PantryItemStoredSchema` and yields `deleted: false`
- **pantry-mutations.AC1.4 Success:** `pantryItemToApiPayload(item)` produces a snake_case object with all 12 fields (`uid`, `ingredient`, `quantity`, `aisle`, `aisle_uid`, `expiration_date`, `has_expiration`, `in_stock`, `purchase_date`, `location_uid`, `notes`, `deleted`)
- **pantry-mutations.AC1.5 Success:** `pantryItemToApiPayload({...item, deleted: true})` includes `deleted: true` in the output
- **pantry-mutations.AC1.6 Edge:** `null` values for `expirationDate`, `notes`, `locationUid`, and `purchaseDate` survive the wire→stored round-trip and the camelCase→snake_case payload conversion
- **pantry-mutations.AC1.7 Failure:** Wire JSON with `deleted` set to a non-boolean (e.g., string `"true"`) is rejected by `PantryItemSchema`

### pantry-mutations.AC2: Client write method

- **pantry-mutations.AC2.1 Success:** `savePantryItem(item)` POSTs gzip-compressed JSON in a multipart form with field name `data` to `/api/v2/sync/pantry/` and returns the input item when the server responds with `{result: true}`
- **pantry-mutations.AC2.2 Success:** HTTP 401 triggers a single re-auth retry via the existing `request<T>` machinery
- **pantry-mutations.AC2.3 Success:** Retryable HTTP statuses (429, 500, 502, 503) trigger the existing cockatiel retry+circuit policy
- **pantry-mutations.AC2.4 Failure:** A non-retryable HTTP error (e.g., 400) throws `PaprikaAPIError` carrying `status` and `endpoint`
- **pantry-mutations.AC2.5 Failure:** A response envelope where `result` is not boolean is rejected by Zod validation

### pantry-mutations.AC3: `commitPantryItem` helper

- **pantry-mutations.AC3.1 Success (upsert branch):** For an item with `deleted: false`, the helper calls `cache.putPantryItem(item)` → `cache.flush()` → `pantryStore.set(uid, item)` → `server.sendResourceListChanged()` → `client.notifySync()` in that order
- **pantry-mutations.AC3.2 Success (delete branch):** For an item with `deleted: true`, the helper calls `cache.removePantryItem(uid)` → `cache.flush()` → `pantryStore.delete(uid)` → `server.sendResourceListChanged()` → `client.notifySync()` in that order
- **pantry-mutations.AC3.3 Failure:** A `cache.flush()` rejection propagates as a rejected promise; subsequent steps are not executed

### pantry-mutations.AC4: `add_pantry_item` tool

- **pantry-mutations.AC4.1 Success:** With only `ingredient` provided, the handler constructs a full `PantryItem` using all server-derived-field defaults (auto `uid`, `purchaseDate` set to now, `inStock: true`, `hasExpiration: false`, etc.), saves via `savePantryItem`, commits via `commitPantryItem`, and returns markdown describing the new item
- **pantry-mutations.AC4.2 Success:** With `expirationDate` provided, `hasExpiration` is auto-derived to `true`
- **pantry-mutations.AC4.3 Success:** With `expirationDate` omitted, `hasExpiration` defaults to `false` regardless of any explicit `args.hasExpiration` (derivation is the source of truth)
- **pantry-mutations.AC4.4 Success:** All other optional args (`quantity`, `aisle`, `inStock`, `notes`) flow through to the constructed item
- **pantry-mutations.AC4.5 Failure:** A case-insensitive exact-match on `ingredient` against an existing pantry item returns a rejection message naming the existing UID and instructing the caller to use `update_pantry_item`; cache and store are not mutated
- **pantry-mutations.AC4.6 Failure:** `pantryStartGuard` blocks the call before first sync and returns a friendly error
- **pantry-mutations.AC4.7 Failure:** A `savePantryItem` API error returns a `textResult` with the error message; cache and store are not mutated

### pantry-mutations.AC5: `update_pantry_item` tool

- **pantry-mutations.AC5.1 Success:** With `uid` and one or more updatable fields, only the provided fields change; all other fields retain values from the store baseline
- **pantry-mutations.AC5.2 Success:** Setting `inStock: false` via this tool persists correctly (covers the mark-out-of-stock use case without a dedicated tool)
- **pantry-mutations.AC5.3 Success:** Setting `expirationDate` to a non-null value also updates `hasExpiration` to `true`; setting `expirationDate` to `null` updates `hasExpiration` to `false`
- **pantry-mutations.AC5.4 Failure:** Unknown UID returns a "no item found" message; cache and store are not mutated
- **pantry-mutations.AC5.5 Failure:** `pantryStartGuard` blocks the call before first sync
- **pantry-mutations.AC5.6 Failure:** A `savePantryItem` API error returns a `textResult` with the error message; cache and store are not mutated

### pantry-mutations.AC6: `delete_pantry_item` tool

- **pantry-mutations.AC6.1 Success:** With a known UID, the handler sets `deleted: true`, saves via `savePantryItem`, commits via `commitPantryItem` (delete branch), and returns a confirmation message
- **pantry-mutations.AC6.2 Failure:** A second delete on the same UID returns a friendly idempotent message ("already deleted") without re-saving
- **pantry-mutations.AC6.3 Failure:** Unknown UID returns a "no item found" message; cache and store are not mutated
- **pantry-mutations.AC6.4 Failure:** `pantryStartGuard` blocks the call before first sync
- **pantry-mutations.AC6.5 Failure:** A `savePantryItem` API error returns a `textResult` with the error message; cache and store are not mutated

### pantry-mutations.AC7: Smoke test runner

- **pantry-mutations.AC7.1:** On startup, the runner lists the current pantry, identifies items whose `ingredient` field starts with `[mcp-smoke]`, and soft-deletes each via `savePantryItem({...item, deleted: true})` followed by `notifySync()`
- **pantry-mutations.AC7.2:** Happy-path round-trip adds a `[mcp-smoke]` item, lists and asserts presence, updates it (e.g., changes `quantity`), lists and asserts the change, deletes it, and lists and asserts absence
- **pantry-mutations.AC7.3:** Failure-probe section attempts (a) update on a randomly-generated unknown UID, (b) a second delete of the just-deleted item, and (c) an add with `ingredient: ""`, recording the API response or error for each
- **pantry-mutations.AC7.4:** Final output to stdout is a markdown report (header, success/failure summary table, per-step detail) suitable for direct paste into a PR comment; progress messages go to stderr so stdout remains clean

## Glossary

- **`pantryItemToApiPayload`**: Function that converts a camelCase `PantryItem` to the 12-field snake_case wire shape required by the Paprika sync endpoint. Always emits `deleted` (defaulting to `false` for live items). Mirrors `recipeToApiPayload`.
- **`savePantryItem`**: `PaprikaClient` method that gzip-compresses the wire payload, wraps it in a multipart form field named `data`, and POSTs it to `/api/v2/sync/pantry/`. Returns the input item on success (Paprika responds with `{result: true}`, not the full object). Mirrors `saveRecipe`.
- **`commitPantryItem`**: Helper that applies a completed pantry write to the local server state. Branches on `saved.deleted`: the upsert branch calls `putPantryItem → flush → store.set → sendResourceListChanged → notifySync`; the delete branch calls `removePantryItem → flush → store.delete → sendResourceListChanged → notifySync`. Mirrors `commitRecipe`.
- **`pantryStartGuard`**: Guard function used in every pantry tool handler that short-circuits with a friendly error if the pantry has not yet completed its first sync. Prevents writes against an uninitialized store. Introduced in PR #46.
- **`findByIngredient`**: Method on `PantryStore` that performs a tiered fuzzy search over pantry items by ingredient name. `add_pantry_item` uses it for its duplicate-ingredient guard: an exact case-insensitive match is treated as "already exists, reject."
- **Soft-delete via flag**: Deletion pattern where a record is not removed from the backing store but instead marked with a boolean field (`deleted: true`). The item is then POSTed through the same write endpoint. Paprika uses this for pantry items (field: `deleted`) and for recipes (field: `inTrash`).
- **Gzip multipart wire format**: The HTTP encoding used for Paprika sync writes — JSON is gzip-compressed and sent as a multipart form-data body with a field named `data`. Required by the `/api/v2/sync/pantry/` and `/api/v2/sync/recipe/{uid}/` endpoints.
- **Replace-all sync with orphan cleanup**: The pantry sync strategy, in contrast to the recipe hash-based diff. On each sync cycle the full pantry list from the API replaces the local store; items present locally but absent from the response are treated as orphans and deleted. This means a write that fires during a sync window can be orphaned — the same race that exists for recipe writes.
- **Branded UID / `PantryItemUidSchema`**: A Zod-branded string schema that marks a plain `string` as a validated pantry item UID. New UIDs are generated with `PantryItemUidSchema.parse(crypto.randomUUID())`, ensuring the type system enforces UID provenance without runtime overhead. The recipe path uses the same idiom.
- **`pantryStore` / `PantryStore`**: The in-memory store holding the current pantry snapshot, populated during sync. Exposes `get`, `set`, `delete`, and `findByIngredient`. Pantry tool handlers read from and write to this store after every API call.
- **`deleted` optional-with-default schema strategy**: The decision to declare `deleted: z.boolean().optional().default(false)` rather than `z.boolean()` on the pantry schemas. The `.optional()` handles API responses that omit the field for live items; `.default(false)` ensures the parsed object always carries a concrete boolean, so no downstream code needs to handle `undefined`.
- **Smoke test runner / `[mcp-smoke]` prefix**: `scripts/smoke-pantry-write.ts` is a manual validation script that runs against a real Paprika account. It identifies its test items by the `[mcp-smoke]` prefix on the `ingredient` field, allowing cleanup of leftover items from prior runs. The runner is the primary empirical check for wire-format assumptions that cannot be confirmed from community implementations alone.

## Architecture

Pantry write support extends the read infrastructure delivered by PR #46 with three MCP tools (`add_pantry_item`, `update_pantry_item`, `delete_pantry_item`), one client method (`PaprikaClient.savePantryItem`), one payload converter (`pantryItemToApiPayload`), and one helper (`commitPantryItem`). The wire format is gzip-compressed JSON in a multipart `data` field POSTed to `/api/v2/sync/pantry/`, mirroring `saveRecipe`. Soft-delete is performed by setting `deleted: true` on the item and POSTing through the same endpoint — there is no separate DELETE method on the client.

**Data flow:**

```
add_pantry_item / update_pantry_item / delete_pantry_item
  → build full PantryItem (with deleted: false or true)
  → ctx.client.savePantryItem(item)        // gzip multipart POST /sync/pantry/ (collection URL, no UID in path)
  → commitPantryItem(ctx, saved)
       ├─ if saved.deleted:
       │    cache.removePantryItem → flush → store.delete → sendResourceListChanged → notifySync
       └─ else:
            cache.putPantryItem → flush → store.set → sendResourceListChanged → notifySync
```

**Key components:**

- **`PantryItemSchema` / `PantryItemStoredSchema` extension** (`src/paprika/types.ts`) — Add `deleted: z.boolean().optional().default(false)` to both schemas. The `.default(false)` makes the field absent-tolerant on reads (Paprika may omit it for live items) while the type system treats `deleted` as a non-optional `boolean` everywhere else in the codebase.
- **`pantryItemToApiPayload(item)`** (`src/paprika/client.ts`) — CamelCase→snake_case converter producing the 12-field wire shape, paralleling `recipeToApiPayload`. Always emits `deleted` (default `false` for live items, `true` only when the delete tool sets it).
- **`PaprikaClient.savePantryItem(item)`** (`src/paprika/client.ts`) — Builds gzip multipart from the payload via a private helper (mirroring `buildRecipeFormData` in transport, but the body is a single-element array `[payload]` and the multipart filename is `"file"`), POSTs to `${API_BASE}/pantry/` (collection URL, no UID in path — diverges from `saveRecipe`), validates a `z.boolean()` envelope, and returns the input as-saved (Paprika returns just `true`).
- **`commitPantryItem(ctx, saved)`** (`src/tools/pantry-helpers.ts`) — Branches on `saved.deleted`: the upsert branch upserts cache+store and notifies; the delete branch removes from cache+store and notifies. Mirrors `commitRecipe`'s ordering (cache first, then store, then MCP notification, then `notifySync`).
- **`add_pantry_item` handler** (`src/tools/pantry-add.ts`) — Constructs a full `PantryItem` with sensible defaults (per the field defaults table in Implementation Phases). Rejects duplicate ingredient names case-insensitively via `pantryStore.findByIngredient` before generating a UID. Generates UIDs with `PantryItemUidSchema.parse(crypto.randomUUID())`, matching the recipe UID generation pattern.
- **`update_pantry_item` handler** (`src/tools/pantry-update.ts`) — Partial-merge tool surface mirroring `update_recipe` line-for-line: fetch baseline from `pantryStore.get(uid)`, conditional-spread for each provided field, save full object via `savePantryItem`, commit via `commitPantryItem`. Auto-derives `hasExpiration` from `expirationDate` provision.
- **`delete_pantry_item` handler** (`src/tools/pantry-delete.ts`) — Mirrors `delete_recipe`: fetch baseline, idempotent guard ("already deleted"), set `deleted: true`, save, commit via the delete branch.

**Divergences from the recipe write pattern:**

| Aspect                                         | Recipe                                                          | Pantry                                                          |
| ---------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Soft-delete field                              | `inTrash: boolean`                                              | `deleted: boolean`                                              |
| Schema default for soft-delete field           | Required (no default)                                           | Optional with `.default(false)`                                 |
| Idempotency on creation                        | None (duplicate names allowed)                                  | Case-insensitive exact-match rejection on `ingredient`          |
| Single client write method                     | `saveRecipe` (delete via separate `deleteRecipe` orchestration) | `savePantryItem` (delete via `deleted: true` flag in same call) |
| Sync diff strategy (read side, unchanged here) | Hash-based via `diffRecipes`                                    | Replace-all with orphan cleanup                                 |

The `deleted`-with-default schema strategy and the duplicate-ingredient guard are the only behaviorally novel pieces; everything else is a direct mirror of the recipe pattern.

## Existing Patterns

This design follows established patterns from the recipe write path:

| New component                                          | Pattern source                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pantryItemToApiPayload()`                             | `recipeToApiPayload()` in `src/paprika/client.ts:62-93` (camelCase→snake_case literal mapping)                                                           |
| `PaprikaClient.savePantryItem()`                       | `PaprikaClient.saveRecipe()` in `src/paprika/client.ts:139-143` (gzip multipart, `z.boolean()` envelope, return input as-saved)                          |
| `commitPantryItem()`                                   | `commitRecipe()` documented in `src/tools/CLAUDE.md` (cache.putX → flush → store.set → sendResourceListChanged → notifySync)                             |
| `add_pantry_item` handler                              | `create_recipe` at `src/tools/create.ts:46-75` (full-object construction with placeholder fields, server-fills, UID generation via branded schema parse) |
| `update_pantry_item` handler                           | `update_recipe` at `src/tools/update.ts:60-77` (conditional-spread partial-merge, `args.x !== undefined && { x: args.x }`)                               |
| `delete_pantry_item` handler                           | `delete_recipe` at `src/tools/delete.ts:24-43` (soft-delete via flag, idempotent guard, exact-UID requirement)                                           |
| Tool registration in `index.ts`                        | Existing `registerListPantryTool` / `registerGetPantryItemTool` calls (PR #46)                                                                           |
| Schema strategy for soft-delete field                  | `inTrash: z.boolean()` on `RecipeStoredSchema` (`src/paprika/types.ts:47`); the `.default(false)` divergence is documented in Additional Considerations  |
| `pantryStartGuard` usage in handlers                   | Read tools `src/tools/pantry-list.ts` and `src/tools/pantry-get.ts` (PR #46)                                                                             |
| `pantryStore.findByIngredient` for duplicate detection | `findByIngredient` exposed by `PantryStore` from PR #46 (tiered fuzzy match — exact takes priority for our case-insensitive duplicate check)             |

The duplicate-ingredient rejection in `add_pantry_item` reuses the existing `findByIngredient` API: an exact case-insensitive match returns the existing item, which the handler interprets as "already exists, reject." This is the only new use of an existing pattern for a slightly different purpose; everything else is a one-to-one mirror.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Schema extension and payload converter

**Goal:** Extend pantry types with the `deleted` field and add the wire-payload converter.

**Components:**

- `PantryItemSchema` and `PantryItemStoredSchema` extended with `deleted: z.boolean().optional().default(false)` in `src/paprika/types.ts`
- `pantryItemToApiPayload(item: Readonly<PantryItem>): Record<string, unknown>` in `src/paprika/client.ts`, placed next to `recipeToApiPayload`
- Type-level tests in `src/paprika/types.test.ts` for round-trip with and without `deleted`, null nullable fields
- Converter tests in `src/paprika/client.test.ts` for snake_case shape, `deleted: true` and `deleted: false` outputs, null-field passthrough

**Dependencies:** None (first phase)

**Done when:** Schemas accept `deleted` (present or absent), converter produces the documented wire shape, all of `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. Covers `pantry-mutations.AC1.*`.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Client write method

**Goal:** Add the `savePantryItem` method to `PaprikaClient`.

**Components:**

- `PaprikaClient.savePantryItem(item: Readonly<PantryItem>): Promise<PantryItem>` in `src/paprika/client.ts`
- Private helper `buildPantryFormData(item)` mirroring `buildRecipeFormData`
- msw handler for `POST /api/v2/sync/pantry/` accepting multipart with gzip-compressed JSON, returning `{result: true}`
- Tests in `src/paprika/client.test.ts` for happy-path POST, retry on 401 with re-auth, retry on 429/500/502/503, error throw on non-retryable status, Zod rejection on bad envelope shape

**Dependencies:** Phase 1 (uses `pantryItemToApiPayload`)

**Done when:** `savePantryItem` succeeds against the mocked endpoint with the correct multipart body, all error paths covered by tests, all gates pass. Covers `pantry-mutations.AC2.*`.

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: `commitPantryItem` helper

**Goal:** Add the local-side commit helper with branches for upsert and delete.

**Components:**

- `commitPantryItem(ctx: ServerContext, saved: Readonly<PantryItem>): Promise<void>` exported from `src/tools/pantry-helpers.ts`
- Branch logic: `if (saved.deleted)` invokes the delete sequence (`removePantryItem` → `flush` → `pantryStore.delete` → `sendResourceListChanged` → `notifySync`), else the upsert sequence (`putPantryItem` → `flush` → `pantryStore.set` → `sendResourceListChanged` → `notifySync`)
- Tests in a new test file or extension to `src/tools/pantry-helpers.test.ts` (or the closest existing test file) verifying call ordering for both branches with mocked `cache`, `pantryStore`, `server`, and `client`

**Dependencies:** Phase 1 (uses `PantryItem` type with `deleted` field)

**Done when:** Both branches call the documented sequence in order, tests assert call ordering, all gates pass. Covers `pantry-mutations.AC3.*`.

<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->

### Phase 4: `add_pantry_item` tool

**Goal:** Register the add tool with full defaults and duplicate-ingredient rejection.

**Components:**

- `registerAddPantryItemTool(server, ctx)` in `src/tools/pantry-add.ts`
- Input schema with `ingredient` required and `quantity`, `aisle`, `expirationDate`, `inStock`, `notes` optional
- Handler logic: `pantryStartGuard(ctx).match()`, case-insensitive duplicate-ingredient lookup via `pantryStore.findByIngredient`, full `PantryItem` construction per the server-derived-field defaults table, `client.savePantryItem(item)`, `commitPantryItem(ctx, saved)`, markdown-formatted response via `pantryItemToMarkdown` (already exists from PR #46)
- Tool registration in `src/index.ts` after the read tool registrations
- Tests in `src/tools/pantry-add.test.ts` using `makeTestServer()` + `makeCtx()` covering: only-ingredient happy path, all-args happy path, expirationDate-derives-hasExpiration, duplicate rejection (exact case-insensitive), `pantryStartGuard` block, API error path

**Dependencies:** Phases 1-3 (types, client, commit helper)

**Done when:** Tool registers and handles all documented cases, including duplicate rejection naming the existing UID, all gates pass. Covers `pantry-mutations.AC4.*`.

**Server-derived field defaults (used at construction time):**

| Field            | Default                                                      |
| ---------------- | ------------------------------------------------------------ |
| `uid`            | `PantryItemUidSchema.parse(crypto.randomUUID())`             |
| `ingredient`     | from args (required)                                         |
| `quantity`       | `args.quantity ?? ""`                                        |
| `aisle`          | `args.aisle ?? ""`                                           |
| `aisleUid`       | `""` (smoke-test contingent — see Additional Considerations) |
| `expirationDate` | `args.expirationDate ?? null`                                |
| `hasExpiration`  | derived: `args.expirationDate != null`                       |
| `inStock`        | `args.inStock ?? true`                                       |
| `purchaseDate`   | `new Date().toISOString()`                                   |
| `locationUid`    | `null`                                                       |
| `notes`          | `args.notes ?? null`                                         |
| `deleted`        | `false`                                                      |

<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->

### Phase 5: `update_pantry_item` and `delete_pantry_item` tools

**Goal:** Register the remaining two write tools.

**Components:**

- `registerUpdatePantryItemTool(server, ctx)` in `src/tools/pantry-update.ts` with input schema `uid` required and all other fields optional; handler does conditional-spread partial-merge over the store baseline, auto-derives `hasExpiration` from `expirationDate` when provided, saves and commits via the upsert branch
- `registerDeletePantryItemTool(server, ctx)` in `src/tools/pantry-delete.ts` with input schema `uid` required; handler fetches baseline from store, returns idempotent message if `existing.deleted`, otherwise sets `deleted: true`, saves, commits via the delete branch
- Both tools registered in `src/index.ts`
- Tests in `src/tools/pantry-update.test.ts` and `src/tools/pantry-delete.test.ts` using the standard test utilities, covering all listed acceptance criteria

**Dependencies:** Phases 1-4

**Done when:** Both tools register and handle all documented cases (partial merge, mark-out-of-stock, unknown UID, idempotent already-deleted), all gates pass. Covers `pantry-mutations.AC5.*` and `pantry-mutations.AC6.*`.

<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->

### Phase 6: Smoke test runner

**Goal:** Manual-validation runner exercising the full pantry write path against a real Paprika account.

**Components:**

- `scripts/smoke-pantry-write.ts` (run via `npx tsx`) with three discrete sections: cleanup of `[mcp-smoke]`-prefixed items, happy-path round-trip (add → list → update → list → delete → list), failure probes (update unknown UID, double-delete, empty-ingredient add)
- Diagnostics emitted via `process.stderr.write`; the final markdown report emitted via `process.stdout.write` so it can be redirected and pasted directly into the PR comment
- Authentication uses the existing config-loading + `PaprikaClient.authenticate()` flow; no new auth code

**Dependencies:** Phases 1-5 (the runner exercises the entire write path)

**Done when:** The runner can be executed locally against a real Paprika account, completes all three sections, and produces a markdown report on stdout. The runner is the empirical validator for the wire-format assumptions and the smoke-test-contingent decisions (empty `aisle`/`aisleUid` handling). Covers `pantry-mutations.AC7.*`.

<!-- END_PHASE_6 -->

## Additional Considerations

**`deleted` field schema strategy.** Recipes model `inTrash: z.boolean()` as a required field on `RecipeStoredSchema`. We could not do the same for pantry items because the read API may omit `deleted` for live items (kappari documents the soft-delete-via-flag pattern but does not confirm whether reads include the field for non-deleted entries). Using `z.boolean().optional().default(false)` makes parsing absent-tolerant while the resulting type still treats `deleted` as a non-optional `boolean` everywhere in our code. This is a safe, conservative choice; if smoke testing confirms the API always includes `deleted` in reads, the `.optional()` can be removed in a follow-up.

**Duplicate-ingredient rejection rationale.** Pantry items have a strong natural-key affinity (an LLM saying "add butter" twice almost certainly means one entry, not two). Recipes do not have this property — two recipes named "Pancakes" can legitimately exist. Rejecting duplicates with an explicit message ("an item with this ingredient exists; use update_pantry_item with uid X") gives the LLM a clear next action. Treating the duplicate-add as an implicit update was considered and rejected because it makes the tool's effect ambiguous when the user provides partial fields.

**Smoke-test contingency for empty aisle.** This PR sends `aisle: ""` and `aisle_uid: ""` when the caller does not provide an aisle. We do not know whether Paprika rejects writes with empty aisle fields. The smoke test runner is the empirical validator. If it reveals rejection, [#56](https://github.com/bojanrajkovic/issues/56)'s deliverables (aisle client method, store, sync, `list_aisles` tool, name→UID resolution) become a hard prerequisite for this PR and must land first; the design plan and PR description will be updated to reflect that. If the smoke test reveals that empty fields are accepted, no further work is needed in this PR.

**Sync race acceptance.** The race where a sync cycle starts within the propagation window of a fresh write — flagging the just-written item as `removed` (recipes) or as an orphan (pantry) — is real and shared by both entity types. Recipes have shipped with this race; pantry inherits the same profile. Tracked in [#57](https://github.com/bojanrajkovic/mcp-paprika/issues/57) as a unified follow-up. No mitigation in this PR.

**No bulk operations.** All three tools operate on one item at a time. Bulk add/update/delete is not in scope. Recipes have no bulk operations either; consistency with that surface is intentional.

## Documents to Update

| Document                | Change                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` (root)      | Add `add_pantry_item`, `update_pantry_item`, `delete_pantry_item` to the project structure overview                                                                                                                                             |
| `src/paprika/CLAUDE.md` | Add `deleted` field to `PantryItem` schema docs; add `pantryItemToApiPayload`, `savePantryItem`, and the private `buildPantryFormData` helper to the client contract; document the pantry write wire format and soft-delete-via-flag convention |
| `src/tools/CLAUDE.md`   | Add the three write tools to the CRUD table; add `commitPantryItem` to the pantry-helpers contract with the branch behavior documented                                                                                                          |
