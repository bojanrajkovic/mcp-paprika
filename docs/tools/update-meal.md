# update_meal

Update an existing meal planner entry by UID. Only provided fields change; omitted fields retain their existing values.

## Parameters

| Name         | Type           | Required | Default   | Description                                                                                                                    |
| ------------ | -------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `uid`        | string         | Yes      | —         | Meal UID to update                                                                                                             |
| `recipe_uid` | string \| null | No       | unchanged | Link to a recipe by UID, or pass `null` to demote a recipe meal to freeform. Demotion requires an explicit `name`.             |
| `name`       | string         | No       | unchanged | Display name. Required when passing `recipe_uid: null`. When both `recipe_uid` and `name` are supplied, `name` takes priority. |
| `date`       | string         | No       | unchanged | Meal date. Accepts ISO 8601 (`2026-06-15`) or `yyyy-MM-dd HH:mm:ss`. Normalized to Paprika wire format (UTC).                  |
| `type`       | object         | No       | unchanged | Meal type. Same discriminated-union shapes as `add_meals`: `{"name": "Dinner"}`, `{"uid": "<UID>"}`, or `{"builtin": 2}`.      |
| `scale`      | string \| null | No       | unchanged | Recipe scale, e.g. `"2"` for double. Pass `null` to clear scale.                                                               |

## Behavior

**Spread-merge semantics.** Only fields present in the call are updated. Omitted fields are preserved from the existing meal. Passing `scale: null` explicitly clears the scale; omitting `scale` leaves it unchanged.

**Recipe linking and demotion.**

- `recipe_uid: "<new-uid>"` — re-links the meal to a different recipe. If `name` is omitted, the display name is auto-resolved from the local recipe store. If the recipe isn't in the local store yet, the call returns an error advising you to supply `name` explicitly or wait for the next sync.
- `recipe_uid: null` — demotes a recipe meal to freeform. Requires an explicit `name`; if `name` is omitted and the meal is currently recipe-linked, the call returns an error: `Demoting a recipe meal to freeform requires an explicit name.`
- `recipe_uid: null` on a meal that is already freeform with no other fields supplied is a no-op. The existing meal card is returned without re-posting to Paprika.

**Miss detection.** The tool checks for the meal UID in three tiers (the first two are mutually exclusive at the store lookup — a UID is either in the tombstone set or absent entirely, never both):

1. In the store's tombstone set (previously deleted via this server) → `Meal with UID "<uid>" is already deleted.`
2. Not in the meal store at all → `No meal found with UID "<uid>".`
3. In the store but with `deleted: true` (defense-in-depth) → `Meal "<name>" is already deleted.`

**Non-updatable fields.** `is_ingredient`, `deleted`, and `order_flag` are not exposed in the update schema. The existing values are always preserved unchanged.

**Sync requirement.** Both the meal store and meal type store must be synced before this tool can run. If called before the first sync completes, the tool returns an error.

## Examples

Demote a recipe meal to freeform (supply a new name):

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "recipe_uid": null,
    "name": "Leftover Chili"
  }
}
```

Re-link a meal to a different recipe (name auto-resolves from the store):

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "recipe_uid": "B2C3D4E5-F6A7-8901-BCDE-F12345678901"
  }
}
```

Clear scale on an existing meal:

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "scale": null
  }
}
```

Move a meal to a different date and type in one call:

```json
{
  "name": "update_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "date": "2026-06-20",
    "type": { "name": "Lunch" }
  }
}
```

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
