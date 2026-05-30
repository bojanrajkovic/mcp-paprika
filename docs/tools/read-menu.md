# read_menu

Get a menu by UID or name, rendered day by day with each day's planned recipes. Each recipe line carries its menuitem and recipe UIDs so you can drive `update_menu_item` / `delete_menu_item`.

## Parameters

| Name     | Type   | Required | Description                                                                    |
| -------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `lookup` | object | Yes      | Pick exactly one shape: `{"uid": "..."}` or `{"name": "Thanksgiving Dinner"}`. |

## Behavior

**Name lookup is tiered** (exact → starts-with → contains) and case-insensitive. When multiple menus match within the same tier, a disambiguation list of names + UIDs is returned and you re-invoke with a specific UID. A UID that isn't found returns `No menu found with UID "<uid>".`; a name with no match returns `No menus found matching "<text>".`

**Full-span render.** The menu is rendered across its entire `days` span (Day 1..N). A day with no planned recipes shows `_(no meals planned)_`. Within a day, items sort by their meal-type's order (Breakfast → Lunch → Dinner → custom; an unknown type sorts last), then by item order flag.

**Item UIDs included.** Each recipe line appends `· item \`<uid>\` · recipe \`<recipeUid>\`` (the recipe clause is omitted for freeform items) so an agent can act on a specific menuitem.

**Sync requirement.** The menu, menu-item, and meal-type stores must all be synced (`menuStartGuard`).

## Examples

By name:

```json
{
  "name": "read_menu",
  "arguments": {
    "lookup": { "name": "Thanksgiving Dinner" }
  }
}
```

By UID:

```json
{
  "name": "read_menu",
  "arguments": {
    "lookup": { "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890" }
  }
}
```

## Sample output

```text
# Thanksgiving Dinner

**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Days:** 1
**Notes:** Family recipes only

## Day 1

- **Lunch:** Roast Turkey · item `E5F6A7B8-C9D0-1234-EFA0-345678901234` · recipe `11112222-3333-4444-5555-666677778888`
- **Dinner:** Pumpkin Pie · item `F6A7B8C9-D0E1-2345-FAB1-456789012345` · recipe `22223333-4444-5555-6666-777788889999`
```
