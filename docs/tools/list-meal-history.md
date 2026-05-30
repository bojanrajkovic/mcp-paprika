# list_meal_history

Browse the meal planner as a calendar-style view grouped by date. Answers questions like "what did we eat last week", "when did we last have tacos", or "what's on the planner this month". For recipe details (ingredients, directions), use `read_recipe`.

## Parameters

| Name         | Type   | Required | Default     | Description                                                                                                                |
| ------------ | ------ | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `recipe_uid` | string | No       | —           | Filter to meals for a specific recipe UID. Searches all time when set.                                                     |
| `since`      | string | No       | 30 days ago | Start date, inclusive. Accepts ISO 8601 or `yyyy-MM-dd`. Overrides the 30-day default.                                     |
| `until`      | string | No       | today       | End date, inclusive. Accepts ISO 8601 or `yyyy-MM-dd`. Overrides the 30-day default.                                       |
| `type`       | object | No       | —           | Meal type filter. Searches all time when set. Pick one shape: `{"name": "Dinner"}`, `{"uid": "..."}`, or `{"builtin": 2}`. |
| `offset`     | number | No       | `0`         | Pagination offset.                                                                                                         |
| `limit`      | number | No       | `50`        | Maximum meals to return (max 200).                                                                                         |

## Behavior

**Default window.** With no filter and no `since`/`until`, the tool returns the **last 30 days**. Supplying a `recipe_uid` or `type` filter switches to an **all-time** search instead (so "when did we last have tacos" reaches back past 30 days). Explicit `since`/`until` always override the default.

**Date parsing.** `since`/`until` accept ISO 8601 or `yyyy-MM-dd` and are compared as UTC instants (`since` snaps to start-of-day, `until` to end-of-day). An unparseable value returns `Could not parse since date "<value>". Use yyyy-MM-dd or ISO 8601.` (likewise for `until`).

**Meal type filter.** The `type` discriminated union is resolved by the same shared resolver the write tools use:

- `{"name": "Dinner"}` — case-insensitive display-name match. Unknown names return `Unknown meal type "<name>". Known types: ...` and suggest the `{uid}`/`{builtin}` form for custom types.
- `{"uid": "<MealType UID>"}` — direct UID match; an unknown UID errors rather than silently filtering.
- `{"builtin": 2}` — integer index: 0 = Breakfast, 1 = Lunch, 2 = Dinner, 3 = Snacks.

Filtering by a **built-in** type also surfaces legacy meals (those predating Paprika's mealtypes catalog, which carry `typeUid: null` and only an integer `type`) matching that built-in. Custom types filter by `typeUid` alone.

**Grouping and sort.** Results group by calendar date; within a day, meals are listed by type (Breakfast → Lunch → Dinner → custom). Freeform meals (no linked recipe) are annotated `*(freeform)*`.

**Pagination.** The header shows the count and date range. An `offset` past the end of the result set returns `No meals at offset N of M total. Try a lower offset (the last page starts at offset ...).`

**Sync requirement.** Both the meal store and the meal-type store must be synced. Before the first sync completes the tool returns "Meal data is not yet synced. Try again in a few seconds."

## Examples

Recent planner (default 30-day window):

```json
{
  "name": "list_meal_history",
  "arguments": {}
}
```

When did we last have a specific recipe (all-time):

```json
{
  "name": "list_meal_history",
  "arguments": {
    "recipe_uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

All dinners in a custom window:

```json
{
  "name": "list_meal_history",
  "arguments": {
    "since": "2026-06-01",
    "until": "2026-06-30",
    "type": { "builtin": 2 }
  }
}
```

## Sample output

```text
**Showing 3 meals (2026-06-15 – 2026-06-17)**

### Mon 15
- **Breakfast** · Avocado Toast *(freeform)*
- **Dinner** · Tacos

### Wed 17
- **Dinner** · Leftovers *(freeform)*
```
