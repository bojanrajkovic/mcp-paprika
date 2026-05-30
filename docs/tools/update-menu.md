# update_menu

Update a menu's name, day span, and/or notes. Look it up by UID or name (tiered fuzzy match, case-insensitive).

## Parameters

| Name     | Type   | Required | Description                                                                    |
| -------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `lookup` | object | Yes      | Pick exactly one shape: `{"uid": "..."}` or `{"name": "Thanksgiving Dinner"}`. |
| `name`   | string | No       | New menu name.                                                                 |
| `days`   | number | No       | New day span (integer ≥ 1).                                                    |
| `notes`  | string | No       | New free-text notes.                                                           |

## Behavior

**At least one field.** Provide at least one of `name`, `days`, or `notes`; otherwise the tool returns `Nothing to update. Provide at least one of name, days, or notes.` Omitted fields keep their current values.

**Rename-conflict guard.** Renaming to a name already used by a **different** menu is rejected: `A menu named "<name>" already exists (UID: <uid>). Choose a different name.` A no-op rename to the menu's own current name is allowed.

**Days-shrink guard.** Shrinking `days` below the highest day that already has a planned recipe is rejected — the conflicting recipes are named so you can move or delete those menuitems first:

```text
Cannot shrink "<menu>" to N day(s): K planned recipe(s) fall on later days (planned recipes currently span M day(s)).
- "<recipe>" on day <d>
...
Move or delete those menuitems first, then shrink the menu.
```

**Lookup misses.** `No menu found with UID "<uid>".`, `No menus found matching "<text>".`, or a disambiguation list when a name matches multiple menus.

**Sync requirement.** The menu, menu-item, and meal-type stores must all be synced (`menuStartGuard`). On a Paprika API failure the tool returns `Failed to update menu: <message>`.

## Examples

Rename and add notes:

```json
{
  "name": "update_menu",
  "arguments": {
    "lookup": { "name": "Whole30 week 2" },
    "name": "Whole30 week 2 (revised)",
    "notes": "Swap salmon for cod on day 3"
  }
}
```

Extend the day span:

```json
{
  "name": "update_menu",
  "arguments": {
    "lookup": { "uid": "B2C3D4E5-F6A7-8901-BCDE-F12345678901" },
    "days": 10
  }
}
```

## Sample output

Returns the full menu card (same shape as `read_menu`, without item UIDs):

```text
# Whole30 week 2 (revised)

**UID:** `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
**Days:** 7
**Notes:** Swap salmon for cod on day 3

## Day 1

- **Dinner:** Roast Chicken
```
