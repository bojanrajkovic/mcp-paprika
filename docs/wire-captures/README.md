# Wire Captures

Sanitized HAR 1.2 recordings of Paprika Cloud Sync API traffic, captured via
mitmproxy against the macOS desktop client. Each HAR entry has a descriptive
`comment` field naming the operation (e.g., "add recipe meal: (Not) Butter
Chicken as Breakfast on 2026-05-26").

## Files

| File                 | Entries | Covers                                                                                             |
| -------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `menus.har.json`     | 14      | Menu CRUD, menuitem CRUD, multi-day menus, cascade deletes                                         |
| `meals.har.json`     | 8       | Recipe meals, freeform meals, type changes, add-menu-to-planner                                    |
| `reference.har.json` | 16      | Sync status catalog, mealtypes, startup sync GETs (groceries/pantry/aisles)                        |
| `writes.har.json`    | 31      | Recipe CRUD + hard-delete, photo upload/delete, category CRUD, pantry CRUD, grocery list/item CRUD |

### Key wire format findings from `writes.har.json`

**Deletion semantics** differ by entity type and have two tiers. Recipes use `in_trash: true` on the full recipe object (soft-delete / move to trash), POSTed to the singular endpoint (`POST /api/v2/sync/recipe/{uid}/`). Permanent recipe deletion (empty trash) sets both `in_trash: true` and `deleted: true` on the same 27-field shape to the same singular endpoint. All other entities (pantry, grocery items/lists, categories, meals, menus, menuitems) use `deleted: true` on the entity body, POSTed to the collection endpoint.

**Photo upload** is a three-step sequence: (1) POST the recipe to `/api/v2/sync/recipe/{recipe_uid}/` with `photo` and `photo_large` set to filenames and `photo_hash` set, (2) POST the photo metadata + binary to `/api/v2/sync/photo/{photo_uid}/`, (3) POST the recipe again to confirm. Deleting a photo POSTs a tombstone (`deleted: true`) to `/api/v2/sync/photo/{photo_uid}/`.

**Grocery ingredient auto-creation:** when adding grocery items, the client also POSTs corresponding `GroceryIngredient` entries to `/api/v2/sync/groceryingredients/`. Ingredient records are created or upserted alongside their items rather than pre-existing in the catalog.

## Using in Tests

### Typed fixture access

The codegen (`pnpm generate:fixtures`) produces typed modules in
`src/__fixtures__/wire-captures/`. Each module exports a `fixture()` function
keyed by the HAR comment string — accessing a nonexistent key is a compile
error:

```typescript
import { fixture } from "../__fixtures__/wire-captures/meals.js";

// Compile-time safe — "typo" would be a type error
const f = fixture("add recipe meal: (Not) Butter Chicken as Breakfast on 2026-05-26");

f.method; // "POST"
f.url; // "https://paprikaapp.com/api/v2/sync/meals/"
f.status; // 200
f.requestBody; // parsed JSON (the decoded multipart body)
f.responseBody; // parsed JSON ({result: true})
```

### MSW handler replay

Each module also exports `handlers` — an array of MSW `HttpHandler` objects
generated from the HAR via `@msw/source/traffic`. Use with the project's
`useMswServer()` helper:

```typescript
import { handlers as mealHandlers } from "../__fixtures__/wire-captures/meals.js";
import { useMswServer } from "../__fixtures__/msw.js";

describe("meal planner tools", () => {
  const server = useMswServer([...mealHandlers]);

  it("creates a meal via the API", async () => {
    // fetch("https://paprikaapp.com/api/v2/sync/meals/", { method: "POST" })
    // will return {result: true} from the HAR recording
  });
});
```

The handlers replay responses in order — first request to a matching URL gets
the first recorded response, second gets the second, etc. After exhausting
recorded responses, the last one repeats.

### Extracting wire shapes for schema design

The fixtures contain real Paprika API wire shapes. When implementing a new
entity type, use the captures as ground truth for field names, types, and
formats:

```typescript
import { fixture } from "../__fixtures__/wire-captures/meals.js";

const f = fixture("add recipe meal: (Not) Butter Chicken as Breakfast on 2026-05-26");
const body = f.requestBody as Array<Record<string, unknown>>;
const meal = body[0]!;

// meal is the real wire shape:
// { uid, recipe_uid, name, date, type, type_uid, order_flag, deleted }
//
// Use this to design Zod schemas (MealSchema, MealStoredSchema)
// and TypeScript types (Meal, MealUid) following existing patterns
// in src/paprika/types.ts.
```

## Refactoring Opportunities

### Existing tests to consider

**`src/paprika/client.test.ts`** and **`src/sync-tool-pipeline.test.integration.ts`**
both define duplicate `makeSnakeCaseRecipe()` factories (nearly identical,
differing only in whether they accept overrides). These factories hand-roll the
28-field recipe wire shape. The `reference.har.json` capture now has real
startup sync GET responses showing the actual wire shapes for groceries, aisles,
and pantry.

Potential refactors (not urgent — the existing tests work fine):

1. **Deduplicate `makeSnakeCaseRecipe`** — extract to a shared fixture factory
   in `src/cache/__fixtures__/` (this is independent of HAR captures)

2. **Wire-shape validation tests** — add tests that verify hand-rolled fixture
   factories produce shapes matching real captures. This catches drift if
   Paprika changes field names or adds fields:

   ```typescript
   import { fixture } from "../__fixtures__/wire-captures/reference.js";

   it("hand-rolled pantry fixture matches real wire shape", () => {
     const real = fixture("GET pantry items (startup sync)");
     const body = real.responseBody as { result: Array<Record<string, unknown>> };
     const realKeys = Object.keys(body.result[0]!).sort();

     const handRolled = makePantryItemSnakeCase("test-uid");
     const handRolledKeys = Object.keys(handRolled).sort();

     expect(handRolledKeys).toEqual(realKeys);
   });
   ```

3. **New entity tests (meals, menus, mealtypes)** — when implementing #61/#62/#81,
   use HAR fixtures as the primary test data rather than hand-rolling factories.
   The `mealHandlers` and `menuHandlers` provide realistic API responses for
   integration tests from day one.

### When to use HAR fixtures vs. hand-rolled factories

| Scenario                                         | Use                                             |
| ------------------------------------------------ | ----------------------------------------------- |
| Testing specific error paths (401, 500, timeout) | Hand-rolled MSW handlers (need precise control) |
| Testing schema parsing against real API shapes   | HAR fixtures (ground truth)                     |
| Integration tests for new entity CRUD            | HAR fixtures + `useMswServer([...handlers])`    |
| Property-based tests on data transforms          | Hand-rolled factories with fast-check           |
| Validating hand-rolled fixtures haven't drifted  | Wire-shape comparison tests (HAR as oracle)     |

## Regenerating Fixtures

After editing or adding HAR files:

```bash
pnpm generate:fixtures
```

This reads all `docs/wire-captures/*.har.json` and regenerates TypeScript
modules in `src/__fixtures__/wire-captures/`. The generated files should be
committed (they're what tests import).

## Adding New Captures

Use the `capture-paprika-wire-format` skill (in `.claude/skills/`) which
orchestrates the full pipeline: mitmproxy setup, Paprika UI automation via
computer-use, decode, sanitize, HAR conversion, and fixture generation.

Or manually:

1. Capture traffic with `scripts/capture-api.sh`
2. Decode with `mitmdump -nr <file> -s scripts/decode-capture.py`
3. Sanitize (strip credentials — see the skill for the full pattern)
4. Convert to HAR 1.2 with unique `comment` fields per entry
5. Save to `docs/wire-captures/<entity>.har.json`
6. Run `pnpm generate:fixtures`
