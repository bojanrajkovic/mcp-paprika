# delete_grocery_list

Soft-delete a grocery list by UID.

## Parameters

| Name  | Type   | Required | Default | Description                |
| ----- | ------ | -------- | ------- | -------------------------- |
| `uid` | string | Yes      | —       | Grocery list UID to delete |

## Behavior

This is a soft delete — the list is marked deleted in Paprika and synced to the cloud. Item cleanup is handled server-side by Paprika; this tool does not cascade to items explicitly.

The operation is idempotent. Calling delete on an already-deleted UID returns a friendly "already deleted" message without making another API call. The store's tombstone set tracks UIDs deleted during this session so the idempotent response is reliable even before the next sync.

Only exact UIDs are accepted. Use `list_grocery_lists` or `read_grocery_list` to find the UID first.

## Example

```json
{
  "name": "delete_grocery_list",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

## Sample output

```text
Grocery list "Weekly Groceries" has been deleted.
```
