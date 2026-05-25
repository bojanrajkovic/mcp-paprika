# delete_pantry_item

Soft-delete a pantry item by UID.

## Parameters

| Name  | Type   | Required | Default | Description               |
| ----- | ------ | -------- | ------- | ------------------------- |
| `uid` | string | Yes      | —       | Pantry item UID to delete |

## Behavior

Marks the item as deleted in Paprika. The item is removed from the local pantry store immediately. The deletion propagates to all Paprika clients on the next sync.

**Idempotent:** calling delete on an already-deleted UID returns a friendly "already deleted" message without re-saving to the API. This covers both in-session deletes (tracked via the tombstone set) and items that arrived from the server with `deleted: true`.

Requires an exact UID. Use `get_pantry_item` to look up the UID by ingredient name first.

Requires the pantry to be synced (returns an error if called before the first sync cycle completes).

## Example

```json
{
  "name": "delete_pantry_item",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

## Sample output

```text
Pantry item "Butter" has been deleted.
```
