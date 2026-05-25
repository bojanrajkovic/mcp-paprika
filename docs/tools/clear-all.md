# clear_all

Clear all items from a grocery list via a single batch delete.

## Parameters

| Name      | Type   | Required | Default | Description                              |
| --------- | ------ | -------- | ------- | ---------------------------------------- |
| `listUid` | string | Yes      | —       | Grocery list UID to clear all items from |

## Behavior

Soft-deletes every item in the specified list regardless of purchased status. All deletes are sent in a single batch POST.

If the list is already empty, an informational message is returned without making an API call.

If no list is found with the given UID, an error message is returned.

## Example

```json
{
  "name": "clear_all",
  "arguments": {
    "listUid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

## Sample output

```text
Cleared 7 item(s) from "Weekly Groceries".
```
