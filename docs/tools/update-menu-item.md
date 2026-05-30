# update_menu_item

Update an existing menuitem (a planned recipe within a menu) by UID. Provide at least one of `day`, `type`, or `recipe_uid`; omitted fields keep their current values.

## Parameters

| Name         | Type   | Required | Description                                                                    |
| ------------ | ------ | -------- | ------------------------------------------------------------------------------ |
| `uid`        | string | Yes      | UID of the menuitem to update.                                                 |
| `day`        | number | No       | New 1-indexed day. Moving past the menu's span auto-extends it.                |
| `type`       | object | No       | New meal type (same DU as `add_menu_items`: `{name}` / `{uid}` / `{builtin}`). |
| `recipe_uid` | string | No       | New recipe UID. Display name re-resolves from the new recipe.                  |

## Behavior

**At least one field.** With none of `day`/`type`/`recipe_uid`, returns `Nothing to update. Provide at least one of day, type, or recipe_uid.`

**Recipe swap re-resolves the name.** Supplying `recipe_uid` re-resolves the display name from the local recipe store. An unknown recipe returns `recipe_uid "<uid>" is not known to the local recipe store; wait for the next sync and retry.`

**Day move auto-extends + re-sequences.** Moving an item to a later `day` than the parent menu's span auto-extends the menu (so the item stays visible under `read_menu`'s Day 1..N render). A day change also re-sequences the item to the **end** of the menu-wide `order_flag` run (`order_flag` is menu-wide, not per-day). A same-day change preserves the order flag.

**Menu link is fixed.** `menu_uid` is not editable here — to move an item between menus, delete it and re-add it via `add_menu_items`.

**Miss detection.** A tombstoned UID → `Menu item with UID "<uid>" is already deleted.`; an unknown UID → `No menu item found with UID "<uid>".`

**Sync requirement.** The menu, menu-item, and meal-type stores must all be synced (`menuStartGuard`). On a Paprika API failure the tool returns `Failed to update menu item: <message>` (or a span-extension failure message), and the item is not moved.

## Examples

Move an item to a different day:

```json
{
  "name": "update_menu_item",
  "arguments": {
    "uid": "E5F6A7B8-C9D0-1234-EFA0-345678901234",
    "day": 4
  }
}
```

Swap the recipe and change the meal type:

```json
{
  "name": "update_menu_item",
  "arguments": {
    "uid": "E5F6A7B8-C9D0-1234-EFA0-345678901234",
    "recipe_uid": "C3D4E5F6-A7B8-9012-CDEF-123456789012",
    "type": { "builtin": 1 }
  }
}
```

## Sample output

```text
Menu item "Beef Stew" updated (day 4).
```

When the move extends the span, the message is prefixed: `Extended the menu to 4 day(s). Menu item "Beef Stew" updated (day 4).`
