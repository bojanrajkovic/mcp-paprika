# add_menu_to_planner

Instantiate a saved menu's recipes as meal-planner entries. Look the menu up by UID or name, then materialize each of its items into a meal dated `start_date + (day − 1)` days, posting them all in one batch. This is the cross-entity bridge from **menus** (recipe collections) to the **meal planner**.

## Parameters

| Name         | Type   | Required | Description                                                                                                                              |
| ------------ | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `menu`       | object | Yes      | Menu lookup. Pick exactly one shape: `{"uid": "..."}` or `{"name": "Whole30 week 2"}` (tiered fuzzy match).                              |
| `start_date` | string | Yes      | Calendar day for the menu's day-1 items (ISO 8601 / `yyyy-MM-dd`; time-of-day dropped). Day-N items land on `start_date + (N − 1)` days. |

## Behavior

**One-way copy, not a link.** The planner meals carry **no** back-reference to the menu. Editing the menu later does not change meals already added, and vice versa — exactly like Paprika.app's own "Add Menu" action.

**Not idempotent.** Re-running adds a **second copy** of the menu to the planner. There is no de-duplication against existing planner meals. This is by design and matches the Paprika app.

**Date arithmetic.** `start_date` is parsed once; a day-N item lands on `start_date + (N − 1)` days, rendered at midnight in the input's own calendar day (DST-free — the time-of-day is discarded). An item with `day: 0` is clamped to day 1. An unparseable `start_date` returns `Could not parse start_date "<value>". Use ISO 8601 (e.g., "2026-06-15") or "yyyy-MM-dd HH:mm:ss".` and nothing is posted.

**Recipe re-resolution + all-or-nothing validation.** Display names re-resolve from the local recipe store (the menu item's denormalized name is not trusted). If **any** recipe-linked item references a recipe unknown to the local store, the **whole batch is rejected** with a per-item enumeration and nothing is posted — strict, like `add_meals` / `add_menu_items`. Freeform items (`recipe_uid: null`) keep their stored name.

**Order placement.** Items are materialized in the menu's layout order (day → meal-type order → item order). `order_flag` then sequences per calendar **date** (all meal types on a day share one sequence), so the planner sequence within a date mirrors the menu and matches the wire format.

**Empty menu.** A menu with no items returns `Menu "<name>" has no items to add to the planner.` and posts nothing.

**Meal type.** Each item's stored `typeUid` is preserved on the meal. The vestigial integer `type` resolves from the meal-type catalog (`originalType`), falling back to `0` when the type is custom or unknown — Paprika dispatches off `type_uid`, so this is harmless.

**Sync requirement.** Composes both families' guards: the recipe store (names re-resolve), the menu + menu-item + meal-type stores (`menuStartGuard`), and an explicit meal-store check. If the meal store is still cold the tool returns "Meal planner is not yet synced. Try again in a few seconds."

**Removing meals afterward.** Find them via `list_meal_history` and call `delete_meal` — there's no "remove menu from planner" inverse.

## Examples

Add a multi-day menu starting on a specific date:

```json
{
  "name": "add_menu_to_planner",
  "arguments": {
    "menu": { "name": "Whole30 week 2" },
    "start_date": "2026-05-27"
  }
}
```

By UID:

```json
{
  "name": "add_menu_to_planner",
  "arguments": {
    "menu": { "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890" },
    "start_date": "2026-06-15"
  }
}
```

## Sample output

A menu with a day-1 and a day-3 dinner, started on 2026-05-27 (day-3 lands two days later, on 2026-05-29):

```text
Added 2 meal(s) to the planner from "Multi-Day" (Day 1 = 2026-05-27).

## 2026-05-27 (Day 1)

- **Dinner:** Roast Chicken

## 2026-05-29 (Day 3)

- **Dinner:** Beef Stew
```

The response is compact and day-grouped, with **no per-meal UIDs** — it scales to a full week. To act on an individual meal afterward, look it up with `list_meal_history`.
