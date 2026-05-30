# delete_menu

Delete a menu and all of its planned recipes (menuitems). Look it up by UID or name (tiered fuzzy match, case-insensitive).

## Parameters

| Name     | Type   | Required | Description                                                                    |
| -------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `lookup` | object | Yes      | Pick exactly one shape: `{"uid": "..."}` or `{"name": "Thanksgiving Dinner"}`. |

## Behavior

**Cascade, children first.** The menu's menuitems are soft-deleted **before** the menu itself, so a failure partway through leaves orphaned-but-visible items (which the next sync reconciles) rather than a menu with invisible children. Each cascaded menuitem also has its `menu_uid` nulled, matching the Paprika app's own delete cascade.

**Partial-failure reporting.** If the menuitem cascade fails, the menu is **not** deleted: `Failed to delete the recipes in menu "<name>": <message>. The menu was NOT deleted. Try again.` If the items are deleted but the menu delete then fails, the response says so and notes the next sync should reconcile it.

**Lookup misses.** `No menu found with UID "<uid>".`, `No menus found matching "<text>".`, or a disambiguation list when a name matches multiple menus.

**Sync requirement.** The menu, menu-item, and meal-type stores must all be synced (`menuStartGuard`).

## Example

```json
{
  "name": "delete_menu",
  "arguments": {
    "lookup": { "name": "Whole30 week 2" }
  }
}
```

## Sample output

```text
Menu "Whole30 week 2" and its 14 planned recipe(s) has been deleted.
```

A menu with no items omits the recipe clause:

```text
Menu "Empty Plan" has been deleted.
```
