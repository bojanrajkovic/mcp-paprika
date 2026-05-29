# add_meals

Add one or more meals to the meal planner in a single batch. All items are validated up-front; if any item is invalid, the entire batch is rejected with a per-index error enumeration so every problem can be fixed in one pass.

## Parameters

| Name    | Type  | Required | Description                       |
| ------- | ----- | -------- | --------------------------------- |
| `items` | array | Yes      | Array of meals to add (1 or more) |

Each item is structurally one of two shapes — recipe-linked OR freeform. The two are mutually exclusive: supplying both `recipe_uid` and `name` (or neither) is rejected at parse time.

### Recipe-linked item shape

| Field        | Type           | Required | Description                                                                                         |
| ------------ | -------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `recipe_uid` | string         | Yes      | Recipe UID. Display name auto-resolves from the recipe — `name` is not allowed on this shape.       |
| `date`       | string         | Yes      | Meal date. Accepts ISO 8601 (`2026-06-15`, `2026-06-15T18:30:00-08:00`) or `yyyy-MM-dd HH:mm:ss`.   |
| `type`       | object         | Yes      | Meal type DU: `{"name": "Dinner"}`, `{"uid": "<MealType UID>"}`, or `{"builtin": 2}`. See Behavior. |
| `scale`      | string \| null | No       | Recipe scale, e.g. `"2"` for double. Pass `null` or omit for default.                               |

### Freeform item shape

| Field   | Type           | Required | Description                                                                                                              |
| ------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `name`  | string         | Yes      | Display name. Use this shape when there is no recipe — for ad-hoc meals like "Leftovers" or labels like "Mom's Lasagna". |
| `date`  | string         | Yes      | Same as above.                                                                                                           |
| `type`  | object         | Yes      | Same as above.                                                                                                           |
| `scale` | string \| null | No       | Same as above.                                                                                                           |

## Behavior

**Recipe-linked vs freeform — mutually exclusive.** Paprika.app dispatches a recipe-linked meal's display name off `recipe_uid` (it looks up the recipe and renders that name); a custom `name` stored alongside `recipe_uid` would never render in the UI. The two item shapes structurally enforce this — use the freeform shape (no `recipe_uid`) when you want a custom label like "Mom's Lasagna".

**Date normalization.** Dates parse as ISO 8601 or `yyyy-MM-dd`. The wire string stored is always `yyyy-MM-dd 00:00:00` taken from the input's own calendar day — for offset-bearing inputs (`2026-06-15T22:00:00-08:00`), the user's local June 15 is preserved rather than UTC-shifted to June 16. The meal planner is day-granular, so any time-of-day component is dropped. Unparseable dates produce a per-index error and the batch is rejected before any API calls are made.

**Meal type.** The `type` field accepts three discriminator shapes:

- `{"name": "Dinner"}` — resolved by display name, case-insensitive. Built-in names: Breakfast, Lunch, Dinner, Snacks. Unknown names produce a per-index error listing the known types and suggesting the `{uid}` or `{builtin}` form for custom types.
- `{"uid": "<MealType UID>"}` — resolved by UID directly.
- `{"builtin": 0}` — resolved by integer index: 0 = Breakfast, 1 = Lunch, 2 = Dinner, 3 = Snacks.

**Recipe linking.** Recipe-linked items resolve the display name from the local recipe store. If the recipe isn't in the local store (not yet synced), the item fails validation with an error advising you to wait for the next sync, or to supply a freeform meal (omit `recipe_uid`, supply `name`).

**Order placement.** Each meal is placed at the end of its `(date, type)` bucket. The `order_flag` is assigned as `max(existing flags) + 1`, starting at 0 for an empty bucket. When multiple items in the same batch share a bucket, they're assigned sequential flags in input order — the bucket's state in the store doesn't change mid-batch.

**All-or-nothing validation.** Every item is validated before any API calls. A single invalid item causes the entire batch to fail with a numbered error for each failing item. Items at passing indices are not added.

**No duplicate guard.** There's no server-side check for duplicate meals. Review the planner (via `list_meal_history`) before adding if duplicates are a concern.

**Sync requirement.** Both the meal store and meal type store must be synced before this tool can run. If called before the first sync completes, the tool returns "Meal data is not yet synced. Try again in a few seconds."

## Examples

Single recipe-linked meal:

```json
{
  "name": "add_meals",
  "arguments": {
    "items": [
      {
        "recipe_uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
        "date": "2026-06-15",
        "type": { "builtin": 2 }
      }
    ]
  }
}
```

Single freeform meal (custom label, no recipe):

```json
{
  "name": "add_meals",
  "arguments": {
    "items": [
      {
        "name": "Avocado Toast",
        "date": "2026-06-15",
        "type": { "name": "Breakfast" }
      }
    ]
  }
}
```

Week of dinners in one batch (mix of recipe-linked + freeform):

```json
{
  "name": "add_meals",
  "arguments": {
    "items": [
      { "recipe_uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890", "date": "2026-06-16", "type": { "builtin": 2 } },
      { "recipe_uid": "B2C3D4E5-F6A7-8901-BCDE-F12345678901", "date": "2026-06-17", "type": { "builtin": 2 } },
      { "recipe_uid": "C3D4E5F6-A7B8-9012-CDEF-123456789012", "date": "2026-06-18", "type": { "builtin": 2 } },
      { "name": "Leftovers", "date": "2026-06-19", "type": { "builtin": 2 } },
      { "recipe_uid": "D4E5F6A7-B8C9-0123-DEFA-234567890123", "date": "2026-06-20", "type": { "builtin": 2 } }
    ]
  }
}
```

### Rejected shapes

Supplying both `recipe_uid` and `name` in a single item is rejected at parse time — neither variant matches:

```json
{
  "name": "add_meals",
  "arguments": {
    "items": [
      {
        "recipe_uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
        "name": "Custom Taco Night",
        "date": "2026-06-15",
        "type": { "builtin": 2 }
      }
    ]
  }
}
```

Returns a Zod union error. Use the freeform shape (omit `recipe_uid`) if you want a custom label.

Supplying neither is also rejected — every item needs to be one of the two shapes.

## Sample output

For the single-recipe example above (assuming the recipe is named "Tacos"):

```text
Added 1 meal(s) to the planner.

# Tacos

**UID:** `E5F6A7B8-C9D0-1234-EFAB-345678901234`
**Date:** 2026-06-15 00:00:00
**Type:** Dinner
**Recipe:** Tacos (`A1B2C3D4-E5F6-7890-ABCD-EF1234567890`)
```
