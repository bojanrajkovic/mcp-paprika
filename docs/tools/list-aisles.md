# list_aisles

List all known aisles, sorted by order then name.

## Parameters

None.

## Behavior

Returns all aisles currently in the aisle store, sorted by `orderFlag` ascending, then alphabetically by name within the same order flag value.

Each entry includes the aisle display name and its UID. The UID is needed when specifying an aisle in `add_pantry_items` or `update_pantry_item`.

If no aisles exist, an informational message is returned. Aisles are created in the Paprika app or automatically when you add a pantry item with a new aisle name.

Requires the aisle store to be synced (returns an error if called before the first sync cycle completes).

## Example

```json
{
  "name": "list_aisles",
  "arguments": {}
}
```

## Sample output

```text
- **Dairy** — `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
- **Produce** — `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
- **Bakery** — `C3D4E5F6-A7B8-9012-CDEF-123456789012`
```
