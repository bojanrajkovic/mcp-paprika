# update_meal

Update an existing meal planner entry by UID. The update payload is a discriminated union — pick exactly one shape per call. Only fields you include in `update` change; omitted fields are preserved from the existing meal.

## Parameters

| Name     | Type   | Required | Description                                                                                                            |
| -------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `uid`    | string | Yes      | Meal UID to update                                                                                                     |
| `update` | object | Yes      | The change payload. Picks exactly one of the three shapes below. Empty `{}` returns the existing meal without posting. |

### `update` shapes

The `update` field is a structural union. Each shape is exclusive of the others — supplying fields that don't fit any shape is rejected at parse time.

**Shape 1 — recipe-link change (or "just other fields"):** touch only `recipe_uid` (set to a recipe UID), or update `date` / `type` / `scale` without touching the recipe link. Cannot include `name` — names on recipe-linked meals auto-resolve from the recipe.

| Field        | Type           | Required | Description                                                                                       |
| ------------ | -------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `recipe_uid` | string         | No       | New recipe UID. Display name auto-resolves from the recipe. Omit to leave the link unchanged.     |
| `date`       | string         | No       | New date. Accepts ISO 8601 or `yyyy-MM-dd`. Time-of-day is dropped (meals are day-granular).      |
| `type`       | object         | No       | Meal type. Same DU as `add_meals`: `{"name": "Dinner"}`, `{"uid": "<UID>"}`, or `{"builtin": 2}`. |
| `scale`      | string \| null | No       | Recipe scale (e.g. `"2"`). Pass `null` to clear scale.                                            |

**Shape 2 — set name on a freeform meal:** update the display name of an already-freeform meal. Cannot include `recipe_uid` — to give a recipe-linked meal a custom label, demote first (shape 3). The runtime guard rejects this shape with a "demote first" message if the existing meal is still recipe-linked.

| Field   | Type           | Required | Description                                      |
| ------- | -------------- | -------- | ------------------------------------------------ |
| `name`  | string         | Yes      | New display name. Only valid for freeform meals. |
| `date`  | string         | No       | Same as above.                                   |
| `type`  | object         | No       | Same as above.                                   |
| `scale` | string \| null | No       | Same as above.                                   |

**Shape 3 — demote a recipe meal to freeform:** sets `recipe_uid` to `null`. The new `name` is required when the existing meal is recipe-linked (the demoted meal needs a label, and the recipe is gone). For already-freeform meals, `name` is optional.

| Field        | Type           | Required                                   | Description                              |
| ------------ | -------------- | ------------------------------------------ | ---------------------------------------- |
| `recipe_uid` | null           | Yes                                        | Literal `null` — clears the recipe link. |
| `name`       | string         | Required if existing meal is recipe-linked | New display name for the freeform meal.  |
| `date`       | string         | No                                         | Same as above.                           |
| `type`       | object         | No                                         | Same as above.                           |
| `scale`      | string \| null | No                                         | Same as above.                           |

## Behavior

**Spread-merge.** Only fields present in `update` are changed; omitted fields are preserved. Pass `scale: null` to clear; omit `scale` to leave it unchanged.

**No `name` + `recipe_uid` together.** Paprika.app dispatches a recipe-linked meal's display name off `recipe_uid` (it looks up the recipe's stored name and renders that). A custom `name` stored alongside a `recipe_uid` is never rendered, so the structural union forbids the combination. To give a recipe meal a custom label, demote first via shape 3.

**Date normalization.** `date` accepts ISO 8601 (with or without time-of-day) or `yyyy-MM-dd`. The wire string stored is always `yyyy-MM-dd 00:00:00` taken from the input's own calendar day — for offset-bearing inputs (`2026-06-15T22:00:00-08:00`), the user's local June 15 is preserved rather than UTC-shifted to June 16.

**Order flag on date move.** `order_flag` sequences per calendar **date** — all meal types on a day share one sequence, not a separate sequence per `(date, type)`. If `date` changes, the meal moves to a different date and `orderFlag` is reassigned via `getMaxOrderFlagOn(destDate) + 1` to land at the end of the destination date. A type-only change on the same date preserves the original `orderFlag` (keep-the-position semantic), since the date bucket is unchanged.

**No-effective-change short-circuit.** If the merged payload is field-wise equal to the existing meal (e.g. `update: {}`), the tool returns the existing meal markdown without re-posting to Paprika or triggering a sync notification.

**Miss detection.** Three tiers:

1. UID in the store's tombstone set (previously deleted via this server) → `Meal with UID "<uid>" is already deleted.`
2. UID not in the meal store at all → `No meal found with UID "<uid>".`
3. UID present in the store with `deleted: true` (defense-in-depth) → `Meal "<name>" is already deleted.`

**Non-updatable fields.** `is_ingredient`, `deleted`, and `order_flag` are not exposed in the schema; existing values are preserved.

**Sync requirement.** Both the meal store and meal type store must be synced before this tool runs. If called before the first sync completes, the tool returns "Meal data is not yet synced. Try again in a few seconds."

## Examples

Demote a recipe meal to freeform with a new name (shape 3):

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "update": {
      "recipe_uid": null,
      "name": "Leftover Chili"
    }
  }
}
```

Re-link a meal to a different recipe — name auto-resolves from the local recipe store (shape 1):

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "update": {
      "recipe_uid": "B2C3D4E5-F6A7-8901-BCDE-F12345678901"
    }
  }
}
```

Clear scale on an existing meal (shape 1):

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "update": { "scale": null }
  }
}
```

Move a meal to a different date and type in one call (shape 1):

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "update": {
      "date": "2026-06-20",
      "type": { "name": "Lunch" }
    }
  }
}
```

Update the label on an already-freeform meal (shape 2):

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "update": { "name": "Friday Night Pizza" }
  }
}
```

### Rejected shapes

Supplying both `recipe_uid` (a UID) and `name` is rejected at parse time — no variant matches:

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "update": {
      "recipe_uid": "B2C3D4E5-F6A7-8901-BCDE-F12345678901",
      "name": "Custom Name"
    }
  }
}
```

Returns a Zod union error. To use a custom label, demote first (shape 3), then re-link if needed.

Setting `name` on a recipe-linked meal (shape 2 against the wrong existing state) is also rejected, but at runtime rather than at parse time:

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "<uid-of-recipe-linked-meal>",
    "update": { "name": "Custom Name" }
  }
}
```

Returns `Cannot set name on the recipe-linked meal "<name>". Names auto-resolve from the recipe. To use a custom label, demote first via update_meal({uid, update: {recipe_uid: null, name: "<your label>"}}).`

## Sample output

```text
# Leftover Chili

**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Date:** 2026-06-15 00:00:00
**Type:** Dinner
**Recipe:** _(freeform)_
```

For a recipe-linked meal with scale:

```text
# Tacos

**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Date:** 2026-06-15 00:00:00
**Type:** Dinner
**Recipe:** Tacos (`B2C3D4E5-F6A7-8901-BCDE-F12345678901`)
**Scale:** 2
```
