# list_menus

List all menus (saved meal plans) in Paprika order, with item count and day span per menu. Use `read_menu` to see a menu's full day-by-day breakdown.

## Parameters

None.

## Behavior

Returns every menu in the menu store, sorted by `orderFlag` ascending, then alphabetically by name within the same order flag. Each entry shows the menu name, its item count (live menuitems), its day span, and its UID.

If no menus exist, returns `No menus found.`

**Sync requirement.** The menu, menu-item, and meal-type stores must all be synced (`menuStartGuard`). Before the first sync the tool returns "Menu data is not yet synced. Try again in a few seconds."

## Example

```json
{
  "name": "list_menus",
  "arguments": {}
}
```

## Sample output

```text
- **Thanksgiving Dinner** (4 items, 1 day) — `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
- **Whole30 week 2** (14 items, 7 days) — `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
```
