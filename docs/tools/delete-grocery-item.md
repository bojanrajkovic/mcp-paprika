# delete_grocery_item

Soft-delete a grocery item by UID.

## Parameters

| Name  | Type   | Required | Default | Description                |
| ----- | ------ | -------- | ------- | -------------------------- |
| `uid` | string | Yes      | —       | Grocery item UID to delete |

## Behavior

This is a soft delete — the item is marked deleted and synced to Paprika cloud.

The operation is idempotent. Calling delete on an already-deleted UID returns a friendly "already deleted" message without making another API call. The store's tombstone set tracks UIDs deleted during this session, so the idempotent response is reliable even before the next sync.

Only exact UIDs are accepted. Use `read_grocery_list` to find item UIDs first.

## Example

```json
{
  "name": "delete_grocery_item",
  "arguments": {
    "uid": "B2C3D4E5-F6A7-8901-BCDE-F12345678901"
  }
}
```

## Sample output

```text
Grocery item "Butter" has been deleted.
```
