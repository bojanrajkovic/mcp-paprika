# add_meals

Add one or more meals to the meal planner in a single batch. All items are validated up-front; if any item is invalid, the entire batch is rejected with a per-index error enumeration so every problem can be fixed in one pass.

## Parameters

| Name                 | Type   | Required | Default | Description                                                                                                                                |
| -------------------- | ------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `items`              | array  | Yes      | —       | Array of meals to add (1 or more)                                                                                                          |
| `items[].recipe_uid` | string | No       | —       | Recipe UID to link this meal to. When provided and `name` is omitted, the meal name is auto-resolved from the recipe store.                |
| `items[].name`       | string | No       | —       | Display name for the meal. Required when `recipe_uid` is omitted. When both are supplied, this value is used instead of the recipe's name. |
| `items[].date`       | string | Yes      | —       | Meal date. Accepts ISO 8601 (`2026-06-15`, `2026-06-15T18:30:00Z`) or `yyyy-MM-dd HH:mm:ss`. Normalized to Paprika wire format (UTC).      |
| `items[].type`       | object | Yes      | —       | Meal type. One of: `{"name": "Dinner"}`, `{"uid": "<MealType UID>"}`, or `{"builtin": 2}`. See "Meal type" under Behavior.                 |
| `items[].scale`      | string | No       | `null`  | Recipe scale, e.g. `"2"` for double. Pass `null` or omit to use the recipe's default scale.                                                |

Either `recipe_uid` or `name` must be provided for each item.

## Behavior

**Date normalization.** Dates are parsed and normalized to Paprika wire format (`yyyy-MM-dd HH:mm:ss` UTC). Unparseable dates produce a per-index error and the batch is rejected before any API calls are made.

**Meal type.** The `type` field accepts three discriminator shapes:

- `{"name": "Dinner"}` — resolved by display name, case-insensitive. Built-in names: Breakfast, Lunch, Dinner, Snacks. Unknown names produce a per-index error listing the known types and suggesting the `{uid}` or `{builtin}` form for custom types.
- `{"uid": "<MealType UID>"}` — resolved by UID directly.
- `{"builtin": 0}` — resolved by integer index: 0 = Breakfast, 1 = Lunch, 2 = Dinner, 3 = Snacks.

**Recipe linking.** When `recipe_uid` is provided and `name` is omitted, the meal name is resolved from the local recipe store. If the recipe isn't in the local store (not yet synced), the item fails validation with an error advising you to supply `name` explicitly or wait for the next sync. When `recipe_uid` is omitted entirely, the meal is freeform and carries no recipe link.

**Order placement.** Each meal is placed at the end of its `(date, type)` bucket. The `order_flag` is assigned as `max(existing flags) + 1`, starting at 0 for an empty bucket. When multiple items in the same batch share a bucket, they're assigned sequential flags in input order — the bucket's state in the store doesn't change mid-batch.

**All-or-nothing validation.** Every item is validated before any API calls. A single invalid item causes the entire batch to fail with a numbered error for each failing item. Items at passing indices are not added.

**No duplicate guard.** There's no server-side check for duplicate meals. Review the planner (via `list_meal_history`) before adding if duplicates are a concern.

**Sync requirement.** Both the meal store and meal type store must be synced before this tool can run. If called before the first sync completes, the tool returns an error.

## Examples

Single recipe meal, linked to a recipe by UID:

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

Single freeform meal (no recipe link):

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

Week of dinners in one batch:

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
