# Meal Planner Writes Design

## Summary

This design adds write support for the Paprika meal planner through three new MCP tools — `add_meals`, `update_meal`, and `delete_meal` — following the same layered commit pattern already established for pantry items and grocery items. The architecture decomposes into five ordered phases: a foundation phase that builds leaf-level primitives (date utilities, a new `MealStore` query method, a `saveMeals` Paprika API client method, commit helpers, a shared Zod schema, and a markdown renderer), followed by three parallel tool-implementation phases (one per tool), and a final wiring phase that registers the tools and synchronizes documentation.

The design intentionally avoids invention: every structural decision is traced to an existing precedent file in the codebase (`pantry-batch-add.ts` for all-or-nothing batch validation, `pantry-update.ts` for spread-merge semantics, `pantry-delete.ts` for three-tier idempotency, `grocery-item.ts` for the multi-tool single-file pattern). The one deliberate divergence from grocery-item helpers is the omission of `resourceListChanged()` notifications, because meals are classified as data-only in the MCP surface design — they have no resource template. Input validation is designed for an LLM agent context: the meal-type field is a discriminated union accepting a human-readable name, a raw UID, or a built-in integer index; date inputs are normalized from multiple ISO forms to a single UTC wire format; and batch errors enumerate every failing index with remediation hints rather than stopping at the first failure.

## Definition of Done

- **Three new MCP tools ship: `add_meals` (batch), `update_meal`, `delete_meal`** — backed by a new `PaprikaClient.saveMeals` POST helper and `commitMeal` / `commitMealsBatch` cache helpers that mirror the pantry-item pattern (no `resourceListChanged`, since meals have no resource surface per `docs/mcp-surface-design.md`).
- **Inputs match the LLM-agent UX:** `type` is a Zod discriminated union (`{name} | {uid} | {builtin}`) reusing the read-side resolver shape with case-insensitive, whitespace-trimmed name lookup; `date` accepts an ISO date or datetime and normalizes to UTC midnight `"yyyy-MM-dd 00:00:00"` — the meal planner is day-granular, so any time-of-day component is dropped before the wire write; **`recipe_uid` and `name` are structurally exclusive** — a meal is either recipe-linked (display name auto-resolves from the recipe) or freeform (caller-supplied name) but never both. UIDs are client-minted via `crypto.randomUUID().toUpperCase()`.
- **Custom names on recipe-linked meals are dead data:** Paprika.app's UI dispatches a recipe-linked meal's display name off `recipe_uid` (looking up the recipe's stored name) and never renders the stored `name` field on the meal itself. The server preserves whatever `name` we POST, but the LLM-facing tool surface enforces the structural constraint so callers don't end up storing labels nobody can see. To label a recipe-linked dinner "Mom's Lasagna," use a freeform meal (no `recipe_uid`) — that's what Paprika.app's UI lets the user author too. Verified via direct API experiment + UI eyeball, 2026-05-29.
- **Semantics match established conventions:** batch validation is all-or-nothing with per-item error detail; update uses spread-merge (undefined = keep, explicit `null` = clear); delete is idempotent via the existing `MealStore` tombstone set and distinguishes "already deleted" from "never existed". `order_flag` defaults to `max+1` within the same (date, type) bucket; `is_ingredient` is tool-internal and always `false`.
- **Documentation lands in the same PR:** `docs/mcp-surface-design.md` matrix row for meals is updated to reflect the shipped surface; the audit table gains rows for grocery lists, grocery items, and meals (the stale `list_meals` reference becomes `list_meal_history`). `src/tools/CLAUDE.md` and `src/paprika/CLAUDE.md` document the new helpers and client method. `docs/tools/add-meals.md`, `docs/tools/update-meal.md`, and `docs/tools/delete-meal.md` ship as new per-tool docs; `docs/tools/README.md` gets a new "Meal planner management" section.
- **Out of scope:** `add_menu_to_planner` (#137); `paprika://meal/{uid}` resource template; per-UID `get_meal` tool; any read-side changes (already shipped in #133, `list_meal_history`).

## Acceptance Criteria

### meal-planner-writes.AC1: `add_meals` adds one or more meals to the planner

- **meal-planner-writes.AC1.1 Success:** Single-item batch with `recipe_uid`, `date`, `type` → meal lands in `MealStore` with `name` auto-resolved from `RecipeStore.get(recipe_uid).name`; tool returns a markdown card including the new UID.
- **meal-planner-writes.AC1.2 Success:** Single-item batch with `name` (no `recipe_uid`), `date`, `type` → freeform meal lands with `recipe_uid: null` and the caller-supplied `name`.
- **meal-planner-writes.AC1.3 Success:** Multi-item batch (e.g., a week of dinners) → all items land in one POST and one `commitMealsBatch` call; tool returns one card per item.
- **meal-planner-writes.AC1.4 Failure:** Item with both `recipe_uid` AND `name` → structural-union rejection at the schema layer (recipe-linked variant forbids `name`; freeform variant forbids `recipe_uid`). The combination is invalid input — a stored custom name on a recipe-linked meal would never render in Paprika.app.
- **meal-planner-writes.AC1.5 Success:** Item with `scale: "2"` → wire payload carries `scale: "2"`; subsequent `MealStore.get(uid).scale` returns `"2"`.
- **meal-planner-writes.AC1.6 Success:** Two items in the same batch targeting the same `(date, typeUid)` bucket → first gets `order_flag: max+1`, second gets `max+2` (local `nextFlag` map increments per assignment).
- **meal-planner-writes.AC1.7 Success:** Adding to an empty `(date, typeUid)` bucket → `order_flag: 0`.
- **meal-planner-writes.AC1.8 Edge:** Type DU resolved via each of `{name: "Dinner"}`, `{uid: "<known-uid>"}`, and `{builtin: 2}` — all three produce the same wire `type` and `type_uid`.
- **meal-planner-writes.AC1.9 Success:** Two items in one batch with the same calendar day but different time components (e.g., `"2026-06-15"` and `"2026-06-15T18:30:00Z"`, same `type`) → both normalize to `"2026-06-15 00:00:00"` on the wire and land in the same `(date, typeUid)` bucket with adjacent `order_flag`s. The meal planner is day-granular: Paprika.app stores meals at midnight per `docs/wire-captures/meals.har.json`, and `list_meal_history` groups by `date.slice(0, 10)`.

### meal-planner-writes.AC2: `add_meals` rejects invalid batches with per-index errors

- **meal-planner-writes.AC2.1 Failure:** Batch with one item whose `date` is unparseable → tool returns an error text result naming the failing index AND its specific error; no items are POSTed; `MealStore` unchanged.
- **meal-planner-writes.AC2.2 Failure:** Batch with one item whose `type` is `{name: "Brunch"}` and no such meal type exists → error result naming the index and listing the known types ("Known types: Breakfast, Lunch, Dinner, Snacks. Use the {uid} or {builtin} discriminator to reference a custom meal type.").
- **meal-planner-writes.AC2.3 Failure:** Batch with one item missing both `recipe_uid` and `name` → structural-union rejection at the schema layer (neither variant matches an item with no `recipe_uid` and no `name`).
- **meal-planner-writes.AC2.4 Failure:** Batch with multiple invalid items → error result enumerates **every** failing index, not just the first.
- **meal-planner-writes.AC2.5 Edge:** Empty `items: []` array → Zod `.min(1)` rejects with a clear validation error before the handler runs.

### meal-planner-writes.AC3: `update_meal` partially updates an existing meal

- **meal-planner-writes.AC3.1 Success:** `update_meal({uid, update: {date: "2026-06-15"}})` → only `date` changes; all other fields preserved.
- **meal-planner-writes.AC3.2 Success:** `update_meal({uid, update: {type: {name: "Lunch"}}})` → both wire `type` and `type_uid` update to the resolved Lunch values; other fields preserved.
- **meal-planner-writes.AC3.3 Success:** `update_meal({uid, update: {recipe_uid: "<new-uid>"}})` where prior meal had `name: "Avocado Toast"` (freeform) → `name` re-resolves to the new recipe's name; `recipe_uid` updates.
- **meal-planner-writes.AC3.4 Failure:** `update_meal({uid, update: {recipe_uid: "<new-uid>", name: "Custom Name"}})` → structural-union rejection at the schema layer (recipe-touch variant forbids `name`; name-only variant forbids `recipe_uid`; demote variant requires `recipe_uid: null`). To use a custom label, demote first via `update_meal({uid, update: {recipe_uid: null, name: "<your label>"}})`.
- **meal-planner-writes.AC3.5 Success:** `update_meal({uid, update: {recipe_uid: null, name: "Leftover Chili"}})` → recipe meal demoted to freeform; `recipe_uid: null`, `name: "Leftover Chili"`.
- **meal-planner-writes.AC3.6 Success:** `update_meal({uid, update: {scale: null}})` → `scale` cleared to `null`.
- **meal-planner-writes.AC3.7 Failure:** `update_meal({uid: "<unknown>", update: {name: "..."}})` → returns `"No meal found with UID \"<unknown>\"."`.
- **meal-planner-writes.AC3.8 Failure:** `update_meal({uid: "<tombstoned>", update: {name: "..."}})` → returns `"Meal with UID \"<uid>\" is already deleted."` (tombstone path) or `"Meal \"<name>\" is already deleted."` (defense-in-depth path).
- **meal-planner-writes.AC3.9 Failure:** `update_meal({uid: "<freeform>", update: {recipe_uid: null}})` on a meal that is already freeform (`recipe_uid` already `null`) → no-op-style: returns the unchanged meal (idempotent), no POST.
- **meal-planner-writes.AC3.10 Failure:** `update_meal({uid: "<recipe-meal>", update: {recipe_uid: null}})` without a merged `name` (the existing meal had a name auto-resolved from the now-removed recipe) → returns `"Demoting a recipe meal to freeform requires an explicit name. Add 'name: \"<your label>\"' to the call."` (the inner phrase keeps its single quotes because it shows JSON object-literal syntax).
- **meal-planner-writes.AC3.11 Failure:** `update_meal({uid: "<recipe-meal>", update: {name: "Custom"}})` (name-only update on a recipe-linked meal) → returns a runtime error explaining names auto-resolve from the recipe and pointing at the demote-first remediation. Schema permits the shape (name-update variant); runtime guard enforces the freeform-only semantic.
- **meal-planner-writes.AC3.12 Success:** `update_meal({uid: "<X>", update: {date: <D2>, type: <T2>}})` where the meal moves to a different `(date, typeUid)` bucket that already contains another meal at `orderFlag: 0` → `orderFlag` is reassigned via `getMaxOrderFlagOn(D2, T2) + 1` (same convention as `add_meals`), preventing collisions in the destination bucket. Same-bucket updates preserve the original `orderFlag` (keep-the-position semantic).

### meal-planner-writes.AC4: `delete_meal` soft-deletes idempotently

- **meal-planner-writes.AC4.1 Success:** `delete_meal({uid: "<known-active>"})` → wire payload carries `deleted: true`; `MealStore.get(uid)` reflects deleted state; `MealStore.isTombstone(uid)` becomes true; tool returns `"Meal \"<name>\" on <date> deleted."`.
- **meal-planner-writes.AC4.2 Success:** `delete_meal({uid: "<known-active>"})` followed immediately by `delete_meal({uid: "<same-uid>"})` → second call returns `"Meal with UID \"<uid>\" is already deleted."` (tombstone path) without re-POSTing.
- **meal-planner-writes.AC4.3 Failure:** `delete_meal({uid: "<unknown>"})` → returns `"No meal found with UID \"<unknown>\"."`.
- **meal-planner-writes.AC4.4 Edge:** `delete_meal({uid: "<known>"})` where `MealStore.get(uid).deleted` is already `true` (rare race) → defense-in-depth returns `"Meal \"<name>\" is already deleted."` without re-POSTing.

### meal-planner-writes.AC5: All three tools follow the established commit pattern

- **meal-planner-writes.AC5.1 Success:** Across `add_meals`, `update_meal`, `delete_meal`: pending-write marks are set BEFORE any cache I/O.
- **meal-planner-writes.AC5.2 Success:** Cache I/O uses `Promise.allSettled` (not `Promise.all` which fails fast); failures from the batch are collected.
- **meal-planner-writes.AC5.3 Success:** On any cache I/O failure, ALL marked UIDs are cleared via `clearPending(uid)` before the error is re-thrown.
- **meal-planner-writes.AC5.4 Success:** A single `cache.flush()` and a single `await ctx.client.notifySync()` execute per tool invocation.
- **meal-planner-writes.AC5.5 Failure:** Neither commit helper calls `ctx.notifier.resourceListChanged()` (meals have no resource surface) — assert via spy in unit tests.

### meal-planner-writes.AC6: `mealTypeSpecSchema` is hoisted and shared

- **meal-planner-writes.AC6.1 Success:** `mealTypeSpecSchema` is exported from `src/tools/meal-helpers.ts` and imported by both `src/tools/meal-history.ts` and `src/tools/meal-writes.ts`.
- **meal-planner-writes.AC6.2 Success:** The existing `meal-history.ts` test suite passes unchanged after the import swap.
- **meal-planner-writes.AC6.3 Success:** No remaining inline definition of the type DU in `meal-history.ts`.

### meal-planner-writes.AC7: `MealStore.getMaxOrderFlagOn` returns the bucket maximum

- **meal-planner-writes.AC7.1 Success:** Given meals A (`date: D, typeUid: T, order_flag: 0`) and B (`date: D, typeUid: T, order_flag: 1`), `getMaxOrderFlagOn(D, T)` returns `1`.
- **meal-planner-writes.AC7.2 Success:** Given no matching meal, returns `null` (not `-1`, not `0`).
- **meal-planner-writes.AC7.3 Success:** Tombstoned/deleted meals are excluded from the max calculation.
- **meal-planner-writes.AC7.4 Success:** `is_ingredient: true` meals are excluded from the max calculation.
- **meal-planner-writes.AC7.5 Edge:** Legacy meals with `typeUid: null` — `getMaxOrderFlagOn(D, null)` returns the max among meals on `D` with `typeUid: null`; does not collide with non-null `typeUid` buckets on the same date.

### meal-planner-writes.AC8: `docs/mcp-surface-design.md` is brought in sync

- **meal-planner-writes.AC8.1 Success:** Meals matrix row (line 51) lists `list_meal_history`, `add_meals`, `update_meal`, `delete_meal`.
- **meal-planner-writes.AC8.2 Success:** Audit table (lines 73-83) includes new "Conforming" rows for grocery lists, grocery items, and meals.
- **meal-planner-writes.AC8.3 Success:** No remaining references to `list_meals` (the renamed read tool is `list_meal_history`).

### meal-planner-writes.AC9: Per-tool docs and tools README ship

- **meal-planner-writes.AC9.1 Success:** `docs/tools/add-meals.md`, `docs/tools/update-meal.md`, and `docs/tools/delete-meal.md` exist and follow the established template (H1, paragraph, `## Parameters`, `## Behavior`, `## Examples`, `## Sample output`).
- **meal-planner-writes.AC9.2 Success:** `docs/tools/README.md` has a new `## Meal planner management` section linking to all three.

## Glossary

- **Paprika**: A recipe management app (iOS / macOS / Android) with a proprietary cloud sync API. This MCP server acts as a bridge between LLM agents and that API, translating tool calls into authenticated HTTP requests to Paprika's `/sync/` endpoints.
- **MCP (Model Context Protocol)**: Anthropic's open protocol for exposing tools and resources to LLM clients. Tools are callable functions; resources are addressable data (like `paprika://recipe/{uid}`). This server implements the MCP server side.
- **Discriminated union (DU)**: A TypeScript / Zod pattern where a tagged field (`kind`) distinguishes between variants of a type. Here, the meal-type input is a DU with variants `{name}`, `{uid}`, and `{builtin}`, allowing callers to reference a meal type by whichever identifier they have available.
- **Zod**: A TypeScript schema-validation library used at system boundaries throughout this codebase. Schemas parse and transform raw input, with `.refine()` for cross-field constraints.
- **Soft delete / tombstone**: A deletion strategy where a record is marked `deleted: true` (and tracked in a tombstone set) rather than removed from storage. This enables idempotent delete operations: a second delete on the same UID returns "already deleted" without re-POSTing to the API.
- **Spread-merge**: The update pattern where only explicitly supplied fields overwrite existing values (`undefined` = keep, explicit `null` = clear). Mirrors how Paprika's API expects partial updates.
- **`order_flag`**: A Paprika wire field that controls display order of meals within a given `(date, meal-type)` bucket. New meals are assigned `max + 1` within their bucket to append at the end.
- **`is_ingredient`**: A Paprika wire field that marks meals instantiated as part of a recipe's ingredient shopping (as opposed to user-planned meals). Always `false` for tool-created meals; excluded from `order_flag` bucket calculations.
- **`postEntities` helper**: An internal `PaprikaClient` method that gzips a JSON array and POSTs it to a Paprika sync endpoint. Reused by `savePantryItems`, `saveGroceryItems`, and the new `saveMeals`.

## Architecture

Three new MCP tools — `add_meals`, `update_meal`, `delete_meal` — land in a single `src/tools/meal-writes.ts` file with three registration functions, mirroring the recent `src/tools/grocery-item.ts` precedent. Commit helpers live in `src/tools/meal-helpers.ts` (mirrors `src/tools/grocery-helpers.ts`) and omit the `resourceListChanged()` call because meals have no MCP resource surface per `docs/mcp-surface-design.md` line 51 (meals classified as Data → tools only).

A new `src/utils/dates.ts` exports two pure functions:

```typescript
export function parseInputDate(input: string): DateTime | null;
// Tries "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd",
// then ISO fallback. All parsed as UTC. Returns null on no-match.

export function toWireDateFormat(dt: DateTime): string;
// Returns "yyyy-MM-dd HH:mm:ss" in UTC.
```

These mirror the inline `parseInputDate` currently in `src/tools/meal-history.ts:17-25`. The duplication is intentional for this PR (surgical extraction strategy); `meal-history.ts` will be deduped via a follow-up issue.

`src/cache/meal-store.ts` gets one new method:

```typescript
getMaxOrderFlagOn(date: string, typeUid: MealTypeUid | null): number | null;
// Returns the highest order_flag among non-deleted, non-ingredient meals
// matching (date, typeUid). Returns null when no matching meal exists;
// callers use (result ?? -1) + 1 for the next flag.
```

Implementation is an O(n) walk over `_items.values()`. No new index — the meal set is small in practice (~1500 entries/year for a typical user).

`src/paprika/client.ts` gets `saveMeals(items): Promise<ReadonlyArray<Meal>>` mirroring `savePantryItems` / `saveGroceryItems`. Posts a gzipped JSON array via the existing `postEntities()` helper to `${API_BASE}/sync/meals/`. `src/paprika/types.ts` gets `mealToApiPayload(meal: Meal): MealWireShape` (inverse of `MealSchema`'s read-side transform).

`src/server/build.ts` registers all three tools alongside the existing `registerMealHistoryTool` call.

### Shared schema (hoisted to `meal-helpers.ts`)

```typescript
const mealTypeSpecSchema = z.discriminatedUnion("kind", [
  z.object({ name: z.string().min(1) }).transform((o) => ({ kind: "name" as const, ...o })),
  z.object({ uid: MealTypeUidSchema }).transform((o) => ({ kind: "uid" as const, ...o })),
  z.object({ builtin: z.number().int().min(0).max(3) }).transform((o) => ({ kind: "builtin" as const, ...o })),
]);
```

`meal-history.ts` swaps its inline DU definition for an import of this schema — no behavior change.

### Per-tool input schemas (in `meal-writes.ts`)

```typescript
// add_meals: per-item shape is a structural z.union — each item is EITHER
// recipe-linked (no name allowed; auto-resolved from RecipeStore) OR freeform
// (no recipe_uid allowed). Both variants are .strict() so unrecognized fields
// fail the variant entirely. Property-presence dispatch mirrors mealTypeSpecSchema.
const recipeMealItemSchema = z
  .object({
    recipe_uid: RecipeUidSchema,
    date: z.string().min(1),
    type: mealTypeSpecSchema,
    scale: z.string().min(1).nullable().optional(),
  })
  .strict();

const freeformMealItemSchema = z
  .object({
    name: z.string().min(1),
    date: z.string().min(1),
    type: mealTypeSpecSchema,
    scale: z.string().min(1).nullable().optional(),
  })
  .strict();

const mealItemInputSchema = z.union([recipeMealItemSchema, freeformMealItemSchema]);

const addMealsInputSchema = z.object({
  items: z.array(mealItemInputSchema).min(1),
});

// update_meal: outer object holds `uid` and an `update` payload whose shape is
// a z.union of three .strict() variants. MCP's registerTool requires a flat
// ZodRawShape at the outermost level, which is why the union lives nested under
// `update` rather than at the top.
//
//   recipeUpdateVariant — touch the recipe link (set/change) or change nothing
//                         link-side. No `name` allowed.
//   nameUpdateVariant   — set `name` on a freeform meal. No `recipe_uid` allowed.
//                         Handler rejects at runtime if existing meal is recipe-linked.
//   demoteVariant       — recipe_uid: null. Optional name (required at runtime
//                         when meal is currently recipe-linked).
const recipeUpdateVariant = z
  .object({
    recipe_uid: RecipeUidSchema.optional(),
    date: z.string().min(1).optional(),
    type: mealTypeSpecSchema.optional(),
    scale: z.string().min(1).nullable().optional(),
  })
  .strict();

const nameUpdateVariant = z
  .object({
    name: z.string().min(1),
    date: z.string().min(1).optional(),
    type: mealTypeSpecSchema.optional(),
    scale: z.string().min(1).nullable().optional(),
  })
  .strict();

const demoteVariant = z
  .object({
    recipe_uid: z.literal(null),
    name: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
    type: mealTypeSpecSchema.optional(),
    scale: z.string().min(1).nullable().optional(),
  })
  .strict();

const updateMealInputSchema = z.object({
  uid: MealUidSchema,
  update: z.union([recipeUpdateVariant, nameUpdateVariant, demoteVariant]),
});

const deleteMealInputSchema = z.object({ uid: MealUidSchema });
```

Update semantics: `undefined` keeps existing, explicit `null` clears for `recipe_uid` and `scale`. `recipe_uid: null` demotes a recipe meal to freeform (requires `name` to be present when the meal is currently recipe-linked, else returns a text error). `name` re-resolves from `RecipeStore` when `recipe_uid` changes; same-UID resubmits preserve `name` (partial-merge). `is_ingredient` and `deleted` are tool-internal; not in any input schema.

### Tool contracts

**`add_meals`** sequence:

1. Sync guard: `mealStartGuard(ctx)` — checks BOTH `mealStore.hasSynced` and `mealTypeStore.hasSynced`. The mealtype check is required because `resolveMealTypeSpec` reads from `mealTypeStore`; without the guard, a cold-cache state would surface as a misleading "Unknown meal type" per-item error rather than a clear "still syncing" message.
2. All-or-nothing validation pass: parse `date` via `parseInputDate`; resolve `type` DU inline (rich error per item with available types); the structural-union per-item shape has already enforced "recipe-linked XOR freeform" at the schema layer. For recipe-linked items, look up `RecipeStore.get(recipe_uid)?.name` (returns error if missing — server is source of truth for recipe identity).
3. If any item fails, return one text result enumerating every failing index.
4. UID mint per item: `crypto.randomUUID().toUpperCase()` parsed through `MealUidSchema`.
5. `order_flag` = `(getMaxOrderFlagOn(normalizedDate, typeUid) ?? -1) + 1`. For multi-item batches sharing a `(date, typeUid)` bucket, cache `nextFlag` per key in a local `Map` and increment per assignment.
6. Single batch POST: `await ctx.client.saveMeals(builtItems)`.
7. `commitMealsBatch(ctx, savedItems)`.
8. Return: text header `Added N meal(s).` + per-item `mealToMarkdown` cards including new UIDs.

**`update_meal`** sequence:

1. Sync guards.
2. Fetch existing via `ctx.mealStore.get(uid)`. If absent, run the tombstone idempotency sequence (`"Meal with UID \"<uid>\" is already deleted."` vs `"No meal found with UID \"<uid>\"."`). Defense-in-depth on `existing.deleted` returns `"Meal \"<name>\" is already deleted."`.
3. Destructure `args.update` and dispatch on the structural variant via property presence: `recipeUpdateVariant` (set/change link; if `recipe_uid` differs from existing, re-resolve `name` from `RecipeStore`), `nameUpdateVariant` (runtime guard rejects if existing meal is recipe-linked), `demoteVariant` (require merged `name` when existing meal is currently recipe-linked; no-op return when meal is already freeform and no other fields change). Parse `date` if supplied; resolve `type` DU if supplied.
4. Spread-merge mirroring `pantry-update.ts:88-104`.
5. Single POST + `commitMeal(ctx, saved)`.
6. Return: text result rendering the updated meal.

**`delete_meal`** sequence:

1. Sync guards.
2. Idempotency sequence mirroring `pantry-delete.ts:29-46`: `get(uid)` → if absent and `isTombstone(uid)` → "already deleted"; if absent and not tombstoned → "no meal found"; if present and `existing.deleted` → "already deleted" (defense-in-depth).
3. Set `deleted: true`.
4. Single POST + `commitMeal`.
5. Return: `"Meal \"<name>\" on <date> deleted."`.

## Existing Patterns

This design follows established codebase patterns. Each citation points to the exact template inherited.

- **`src/tools/pantry-batch-add.ts`** — closest template for `add_meals`: all-or-nothing validation, batch POST, batch commit, markdown response with skip report.
- **`src/tools/pantry-update.ts:88-104`** — spread-merge with inline conditionals; the `undefined` vs explicit `null` distinction for clearable fields.
- **`src/tools/pantry-delete.ts:29-46`** — three-tier idempotency check (in-store, tombstone, defense-in-depth `deleted` flag).
- **`src/tools/grocery-item.ts`** — multi-tool single-file pattern: three `register*Tool` functions in one file, each with its own `ctx.log.child({ component: "..." })` logger.
- **`src/tools/grocery-helpers.ts` `commitGroceryItemsBatch` (lines 102-149)** — pending-write marking before cache I/O; `Promise.allSettled` for cache ops; clear all marks on failure; single `cache.flush()` and single `notifySync()`. **Divergence:** meal commit helpers omit `ctx.notifier.resourceListChanged()` (mirror pantry helpers, not grocery — meals have no resource surface).
- **`src/paprika/client.ts` `savePantryItems` / `saveGroceryItems`** — `postEntities` delegation; identity-return after POST (Paprika responds `{result: true}`, not the saved objects).
- **`src/tools/meal-history.ts:114-148`** — type DU resolver logic. Write tools mirror this inline (with richer error messages); consolidation into a shared helper is deferred to a follow-up issue once read and write error messages converge.
- **`src/cache/meal-store.ts`** `TombstoneEntityStore` base — pending-write API (`markPendingUpsert` / `markPendingDelete` / `clearPending`); `set` / `delete` / `isTombstone` / `get` from the base class.
- **`src/paprika/types.ts:363-455`** — `MealUidSchema`, `MealTypeUidSchema`, `MealSchema` (wire-format Zod with snake_case → camelCase transform). The new `mealToApiPayload` transformer is the inverse.

The one place the design **introduces a new file pattern** is `src/utils/dates.ts`. There is no existing date-utilities module to extend; `src/utils/` currently holds `config.ts`, `log.ts`, `xdg.ts`, `duration.ts`. The new file follows the same shape as `duration.ts` (small pure functions, dedicated test file).

## Implementation Phases

Five phases. Phase 1 produces the leaves (no dependencies on each other); Phases 2-4 implement one tool each on top of Phase 1; Phase 5 wires everything in and updates cross-cutting docs.

<!-- START_PHASE_1 -->

### Phase 1: Foundation — helpers, types, client method

**Goal:** Build all the leaf-level scaffolding (date utilities, store method, client method, commit helpers, shared schema, markdown rendering) so subsequent phases implement tools against a stable foundation.

**Components:**

- `src/utils/dates.ts` — `parseInputDate`, `toWireDateFormat` (new file)
- `src/cache/meal-store.ts` — new `getMaxOrderFlagOn(date, typeUid)` method
- `src/paprika/types.ts` — new `mealToApiPayload(meal)` transformer
- `src/paprika/client.ts` — new `saveMeals(items)` method
- `src/tools/meal-helpers.ts` — `mealTypeSpecSchema`, `commitMeal`, `commitMealsBatch`, `mealToMarkdown` (new file)
- `src/tools/meal-history.ts` — one-line import swap to use the hoisted `mealTypeSpecSchema`

**Dependencies:** None (first phase).

**Acceptance criteria covered:** `meal-planner-writes.AC5.*`, `meal-planner-writes.AC6.*`, `meal-planner-writes.AC7.*`.

**Done when:** unit tests pass for each helper; property tests verify `parseInputDate` roundtrip and UTC preservation; commit-helper tests mirror `commitPantryItem`'s pattern (pending marks, flush, store mutation, notifySync); msw-mocked `saveMeals` round-trip succeeds; the existing `meal-history` test suite still passes.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: `add_meals` tool

**Goal:** Ship the batch-add tool with per-index error reporting and per-bucket `order_flag` increment.

**Components:**

- `src/tools/meal-writes.ts` — `registerAddMealsTool` (new file)
- `docs/tools/add-meals.md` — per-tool doc (new)

**Dependencies:** Phase 1.

**Acceptance criteria covered:** `meal-planner-writes.AC1.*`, `meal-planner-writes.AC2.*`.

**Done when:** tool tests cover single add, batch add, recipe-meal name auto-resolve, freeform meal, `scale` field, all-or-nothing validation with per-index error report, `order_flag` `max+1` within bucket, and multi-item same-bucket increment using the local `Map`.

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: `update_meal` tool

**Goal:** Ship the partial-update tool with spread-merge semantics and recipe-link demotion/promotion logic.

**Components:**

- `src/tools/meal-writes.ts` — `registerUpdateMealTool`
- `docs/tools/update-meal.md` — per-tool doc (new)

**Dependencies:** Phase 1.

**Acceptance criteria covered:** `meal-planner-writes.AC3.*`.

**Done when:** tool tests cover partial updates per field (under the nested `update` payload), `recipe_uid: null` demotion (with merged-`name` validation), `recipe_uid` change auto-re-resolving `name`, structural rejection of the `{recipe_uid, name}` combo, idempotent miss on unknown UID, and defense-in-depth on `existing.deleted`.

<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->

### Phase 4: `delete_meal` tool

**Goal:** Ship the soft-delete tool with the established three-tier idempotency sequence.

**Components:**

- `src/tools/meal-writes.ts` — `registerDeleteMealTool`
- `docs/tools/delete-meal.md` — per-tool doc (new)

**Dependencies:** Phase 1.

**Acceptance criteria covered:** `meal-planner-writes.AC4.*`.

**Done when:** tool tests cover delete-existing, delete-already-tombstoned ("already deleted"), delete-unknown ("no meal found"), and defense-in-depth on `existing.deleted`.

<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->

### Phase 5: Wiring + cross-cutting docs

**Goal:** Register the three tools in the MCP server, update the surface-design matrix and audit table, and bring all CLAUDE.md files in sync.

**Components:**

- `src/server/build.ts` — three new `register*Tool` calls
- `docs/mcp-surface-design.md` — matrix row update for meals; audit-table additions for grocery lists, grocery items, meals; `list_meals` → `list_meal_history` fix
- `docs/tools/README.md` — new `## Meal planner management` section
- `/CLAUDE.md`, `src/tools/CLAUDE.md`, `src/paprika/CLAUDE.md`, `src/cache/CLAUDE.md` — see "Documents to Update" table below

**Dependencies:** Phases 2-4.

**Acceptance criteria covered:** `meal-planner-writes.AC8.*`, `meal-planner-writes.AC9.*`.

**Done when:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` are all clean; manual smoke test against a real Paprika account verifies each of the three tools end-to-end.

<!-- END_PHASE_5 -->

## Documents to Update

Project guidance (`.ed3d/design-plan-guidance.md`) requires every design plan to enumerate the documentation that must change alongside the implementation. No new module-level `CLAUDE.md` files are created (project guidance: only for directories that already have them).

| Document                     | Change                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/CLAUDE.md` (top-level)     | Update `src/utils/` description to include `dates.ts`; update `src/tools/` description to mention `meal-writes.ts` and `meal-helpers.ts`.                                                                                                                                                                                           |
| `src/tools/CLAUDE.md`        | Document `commitMeal` / `commitMealsBatch` (explicitly: no `resourceListChanged` because meals have no resource surface — mirror the pantry-helpers note); document `mealTypeSpecSchema` as a shared schema; document `mealToMarkdown`; add entries for `registerAddMealsTool`, `registerUpdateMealTool`, `registerDeleteMealTool`. |
| `src/paprika/CLAUDE.md`      | Document `saveMeals` client method and `mealToApiPayload` transformer.                                                                                                                                                                                                                                                              |
| `src/cache/CLAUDE.md`        | Document new `MealStore.getMaxOrderFlagOn(date, typeUid)` method alongside existing meal-specific methods.                                                                                                                                                                                                                          |
| `docs/mcp-surface-design.md` | Matrix row update for meals (line 51) to reflect shipped surface `list_meal_history`, `add_meals`, `update_meal`, `delete_meal`; audit-table additions (lines 73-83) for grocery lists, grocery items, and meals as Conforming; stale `list_meals` → `list_meal_history` fix.                                                       |
| `docs/tools/README.md`       | New `## Meal planner management` section linking to the three new per-tool docs.                                                                                                                                                                                                                                                    |
| `docs/tools/add-meals.md`    | NEW per-tool doc following the established template (H1, paragraph, `## Parameters` table, `## Behavior`, `## Examples`, `## Sample output`).                                                                                                                                                                                       |
| `docs/tools/update-meal.md`  | NEW per-tool doc, same template.                                                                                                                                                                                                                                                                                                    |
| `docs/tools/delete-meal.md`  | NEW per-tool doc, same template.                                                                                                                                                                                                                                                                                                    |

## Additional Considerations

**UX-over-DX target audience.** Tools are designed for an LLM agent acting on behalf of a non-technical Paprika user. Error messages include remediation hints — the type-DU resolver returns text like `"Unknown meal type 'Brunch'. Known types: Breakfast, Lunch, Dinner, Snacks. Use the {uid} or {builtin} discriminator to reference a custom meal type."` Per-index batch errors (rather than first-failure) follow the same principle.

**Order-flag correctness in batches.** Naïvely calling `getMaxOrderFlagOn` per item for a multi-item batch that shares a `(date, typeUid)` bucket would assign every item the same flag (since none are saved between iterations). The implementation caches `nextFlag` per `(date, typeUid)` key in a local `Map` during the validation pass and increments per assignment.

**No new `MealStore` index.** `getMaxOrderFlagOn` is implemented as an O(n) filter on `_items.values()`. Reconsidering pre-indexing is appropriate if writes hit observable performance limits — not now.

**Naming consistency.** `add_meals` / `update_meal` / `delete_meal` matches the established `add_pantry_items` / `update_pantry_item` / `delete_pantry_item` and `add_grocery_items` / `update_grocery_item` / `delete_grocery_item` precedent. The plural `add_<entities>` form signals batch capability to LLM agents; singular `update_<entity>` and `delete_<entity>` reduce hallucination risk for non-batch ops.

## Out of Scope

- **`add_menu_to_planner`** (issue #137) — cross-entity tool blocked on this issue and #136.
- **`paprika://meal/{uid}` resource template** — meals are explicitly Data class in the surface-design matrix.
- **`get_meal(uid)` tool** — not in the matrix or the issue; deferred until a real ask emerges.
- **Read-side changes to `meal-history.ts`** beyond the one-line `mealTypeSpecSchema` import swap.
- **Back-porting richer error messages or `parseInputDate` dedup to `meal-history.ts`** — tracked as a follow-up issue, filed after design planning completes.
