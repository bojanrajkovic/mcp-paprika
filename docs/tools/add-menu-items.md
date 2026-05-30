# add_menu_items

Add one or more recipe-linked menuitems (planned recipes) to a menu in a single batch. All items are validated up-front; if any item is invalid the entire batch is rejected with a per-index error enumeration.

## Parameters

| Name    | Type   | Required | Description                                                                 |
| ------- | ------ | -------- | --------------------------------------------------------------------------- |
| `menu`  | object | Yes      | Menu lookup. Pick exactly one shape: `{"uid": "..."}` or `{"name": "..."}`. |
| `items` | array  | Yes      | Array of recipe-linked menuitems to add (1 or more).                        |

### Item shape

| Field        | Type   | Required | Description                                                                                                               |
| ------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `recipe_uid` | string | Yes      | Recipe UID. Display name auto-resolves from the recipe — no `name` field is accepted.                                     |
| `day`        | number | Yes      | 1-indexed day within the menu. Days beyond the menu's current span auto-extend the menu.                                  |
| `type`       | object | Yes      | Meal type. Pick one shape: `{"name": "Dinner"}`, `{"uid": "<MealType UID>"}`, or `{"builtin": 2}` (0=Breakfast…3=Snacks). |

Extra keys on an item are rejected at the schema boundary.

## Behavior

**All-or-nothing validation.** Every item is validated before any API calls. An unknown `recipe_uid` (not in the local recipe store) or an unresolvable meal `type` produces a per-index error, and a single failure rejects the whole batch:

```text
Could not add 2 menu items:

Item 0: recipe_uid "..." is not known to the local recipe store; wait for the next sync and retry.
Item 1: unknown meal type "Brunch". Known types: Breakfast, Lunch, Dinner, Snacks. Use the {uid} or {builtin} discriminator to reference a custom meal type.
```

**Auto-extend the menu span.** If the batch's highest `day` exceeds the menu's current span, the menu is grown (`days = maxDay`) and persisted **first**, so the new items never reference days outside a saved menu. The response notes the extension.

**Order placement is menu-wide.** Paprika numbers menuitem `order_flag` across the **whole menu**, not per day. New items seed from the current menu-wide max and take sequential flags in submission order, regardless of day.

**Recipe linking.** Display names denormalize from the local recipe store (matching `add_meals`' contract), so the menu can render recipe names without a second lookup.

**Lookup misses.** `No menu found with UID "<uid>".`, `No menus found matching "<text>".`, or a disambiguation list when a name matches multiple menus.

**Sync requirement.** The menu, menu-item, and meal-type stores must all be synced (`menuStartGuard`). On a Paprika API failure the tool returns `Failed to add menu items: <message>` (or a span-extension failure message), and nothing is added.

## Examples

Add two dinners to a menu by name:

```json
{
  "name": "add_menu_items",
  "arguments": {
    "menu": { "name": "Whole30 week 2" },
    "items": [
      { "recipe_uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890", "day": 1, "type": { "builtin": 2 } },
      { "recipe_uid": "B2C3D4E5-F6A7-8901-BCDE-F12345678901", "day": 3, "type": { "name": "Dinner" } }
    ]
  }
}
```

## Sample output

```text
Added 2 item(s) to menu "Whole30 week 2".

# Whole30 week 2

**UID:** `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
**Days:** 7

## Day 1

- **Dinner:** Roast Chicken · item `E5F6A7B8-C9D0-1234-EFA0-345678901234` · recipe `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
```

When the batch extends the span, the header is prefixed, e.g. `Extended menu "Whole30 week 2" to 10 day(s). Added 1 item(s)...`.
