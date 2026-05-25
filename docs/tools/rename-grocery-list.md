# rename_grocery_list

Rename an existing grocery list to a new name.

## Parameters

| Name      | Type   | Required | Default | Description                   |
| --------- | ------ | -------- | ------- | ----------------------------- |
| `uid`     | string | Yes      | —       | Grocery list UID to rename    |
| `newName` | string | Yes      | —       | New name for the grocery list |

## Behavior

If the new name matches the current name (case-insensitive), the operation is a no-op and returns the list unchanged without making an API call.

If the new name conflicts with a different existing list (case-insensitive exact match on the new name), the rename is rejected. The response includes the conflicting list's name and UID. Choose a different name to proceed.

If no list is found with the given UID, an error message is returned.

On success, the updated list with all its items is returned.

## Examples

Simple rename:

```json
{
  "name": "rename_grocery_list",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "newName": "Weekly Shopping"
  }
}
```

## Sample output

```text
# Weekly Shopping

**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Items:** 3

| Ingredient | Quantity | Aisle   | Purchased |
| ---------- | -------- | ------- | --------- |
| Butter     | 2 lbs    | Dairy   | No        |
| Flour      | 5 lbs    | Baking  | No        |
| Milk       | 1 gal    | Dairy   | No        |
```
