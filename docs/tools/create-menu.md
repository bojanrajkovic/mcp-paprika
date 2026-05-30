# create_menu

Create a new menu (saved meal plan) with the given name. Add recipes to it afterward with `add_menu_items`.

## Parameters

| Name    | Type   | Required | Default | Description                         |
| ------- | ------ | -------- | ------- | ----------------------------------- |
| `name`  | string | Yes      | —       | Menu name.                          |
| `days`  | number | No       | `1`     | Day span of the menu (integer ≥ 1). |
| `notes` | string | No       | `""`    | Optional free-text notes.           |

## Behavior

**Duplicate-name guard.** Rejects a name that exactly matches an existing menu (case-insensitive). On a duplicate, the response names the existing menu and its UID: `A menu named "<name>" already exists (UID: <uid>). Use update_menu to change it.` A starts-with / contains near-match is **not** treated as a duplicate.

**Order placement.** The new menu gets `orderFlag = max(existing) + 1` so it sorts after existing menus in Paprika order.

**Sync requirement.** The menu, menu-item, and meal-type stores must all be synced (`menuStartGuard`).

On a Paprika API failure the tool returns `Failed to create menu: <message>` and nothing is committed.

## Examples

Minimal:

```json
{
  "name": "create_menu",
  "arguments": {
    "name": "Whole30 week 2"
  }
}
```

With a day span and notes:

```json
{
  "name": "create_menu",
  "arguments": {
    "name": "Whole30 week 2",
    "days": 7,
    "notes": "No dairy, no legumes"
  }
}
```

## Sample output

A freshly created menu has no items yet, so each day shows `_(no meals planned)_`:

```text
# Whole30 week 2

**UID:** `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
**Days:** 7
**Notes:** No dairy, no legumes

## Day 1

_(no meals planned)_

## Day 2

_(no meals planned)_
```
