# move_to_pantry

Move one or more grocery items to the pantry.

## Parameters

| Name   | Type     | Required | Default | Description                         |
| ------ | -------- | -------- | ------- | ----------------------------------- |
| `uids` | string[] | Yes      | —       | Grocery item UIDs to move to pantry |

## Behavior

This is a two-step create-then-delete operation:

1. **Create pantry items first** — a new pantry item is created for each grocery item. The ingredient name and aisle are copied from the grocery item. The purchase date is set to today. Quantity is intentionally left empty (grocery quantity represents a purchase amount, not a pantry stock amount).
2. **Delete grocery items second** — all grocery items in the batch are soft-deleted.

If creating pantry items fails, no changes are made.

If deleting grocery items fails after pantry creation, a partial-failure response is returned with the UIDs of the newly-created pantry items so you can manually clean up the grocery items.

All grocery item UIDs are validated before any API calls — if any UID is not found or is already deleted, the entire operation is aborted.

Requires both grocery and pantry stores to be synced.

## Example

```json
{
  "name": "move_to_pantry",
  "arguments": {
    "uids": ["B2C3D4E5-F6A7-8901-BCDE-F12345678901", "C3D4E5F6-A7B8-9012-CDEF-123456789012"]
  }
}
```

## Sample output

```text
Moved 2 item(s) to pantry: Butter, Eggs.
New pantry UIDs: D4E5F6A7-B8C9-0123-DEFA-234567890123, E5F6A7B8-C9D0-1234-EFA0-345678901234
```
