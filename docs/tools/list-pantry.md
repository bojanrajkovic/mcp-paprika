# list_pantry

List all pantry items sorted alphabetically by ingredient name.

## Parameters

None.

## Behavior

Returns a summary list of all non-deleted pantry items. Each line includes the ingredient name, quantity (if set), aisle (if set), in-stock status (when out of stock), expiration date (if set), and UID.

Use `get_pantry_item` with the UID to retrieve full details for a specific item.

Returns an informational message when the pantry is empty.

Requires the pantry to be synced (returns an error if called before the first sync cycle completes).

## Example

```json
{
  "name": "list_pantry",
  "arguments": {}
}
```

## Sample output

```text
You have 3 pantry items:

- **Butter** (2 lbs) — Dairy (uid: `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`)
- **Eggs** (1 dozen) — Dairy · **out of stock** (uid: `B2C3D4E5-F6A7-8901-BCDE-F12345678901`)
- **Flour** (5 lbs) — Baking · expires 2026-12-31 00:00:00 (uid: `C3D4E5F6-A7B8-9012-CDEF-123456789012`)
```
