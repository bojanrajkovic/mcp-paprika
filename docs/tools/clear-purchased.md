# clear_purchased

Clear all purchased items from a grocery list via a single batch delete.

## Parameters

| Name      | Type   | Required | Default | Description                                    |
| --------- | ------ | -------- | ------- | ---------------------------------------------- |
| `listUid` | string | Yes      | —       | Grocery list UID to clear purchased items from |

## Behavior

Soft-deletes all items in the specified list where `purchased` is `true`. All deletes are sent in a single batch POST.

If there are no purchased items in the list, an informational message is returned without making an API call.

If no list is found with the given UID, an error message is returned.

## Example

```json
{
  "name": "clear_purchased",
  "arguments": {
    "listUid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

## Sample output

```text
Cleared 3 purchased item(s) from "Weekly Groceries".
```
