# list_meal_types

List all meal types — the built-in Breakfast/Lunch/Dinner/Snacks plus any custom types — sorted by order then name. Use this to enumerate custom types and resolve a name to a UID before scheduling meals with `add_meals` / `update_meal` / `add_menu_items`.

## Parameters

None.

## Behavior

Returns every meal type in the meal-type store, sorted by `orderFlag` ascending, then alphabetically by name within the same order flag.

Each entry shows:

- the display name,
- whether it is **built-in** (the four defaults, `originalType` 0–3) or **custom** (user-created, `originalType: null`),
- its calendar-export schedule — `all-day`, or a clock time (`HH:MM`) derived from the type's export time,
- and its UID.

Reference a type by name in the `{name}` discriminator, or pass its UID via `{uid}` to `add_meals` / `update_meal` / `add_menu_items`. **Meal types are created and edited in the Paprika app, not through this server** — this tool is read-only.

If no meal types exist, returns `No meal types found.`

**Sync requirement.** Only the meal-type store must be synced (narrower than `add_meals`, which also needs the meal store). Before the first sync the tool returns "Meal types are not yet synced. Try again in a few seconds."

## Example

```json
{
  "name": "list_meal_types",
  "arguments": {}
}
```

## Sample output

```text
- **Breakfast** (built-in, 08:00) — `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
- **Lunch** (built-in, 12:00) — `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
- **Dinner** (built-in, 18:00) — `C3D4E5F6-A7B8-9012-CDEF-123456789012`
- **Snacks** (built-in, all-day) — `D4E5F6A7-B8C9-0123-DEFA-234567890123`
- **Meal Prep** (custom, all-day) — `E5F6A7B8-C9D0-1234-EFA0-345678901234`
```
