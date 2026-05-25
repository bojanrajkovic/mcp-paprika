# update_grocery_item

Update an existing grocery item. Only provided fields are changed; omitted fields retain their current values.

## Parameters

| Name          | Type    | Required | Default | Description                                     |
| ------------- | ------- | -------- | ------- | ----------------------------------------------- |
| `uid`         | string  | Yes      | —       | UID of the grocery item to update               |
| `quantity`    | string  | No       | —       | New quantity; set to empty string `""` to clear |
| `aisle`       | string  | No       | —       | New aisle display name                          |
| `instruction` | string  | No       | —       | New free-form notes                             |
| `purchased`   | boolean | No       | —       | Whether the item has been purchased             |

## Behavior

This is a partial merge — only the fields you provide are updated. Omitting a field leaves it unchanged.

**Ingredient is not updatable.** To change an ingredient, delete the item and add a new one.

**`name` recalculation:** the internal `name` field (stored as `"quantity ingredient"`) is automatically recalculated when `quantity` changes. If you set `quantity` to an empty string, `name` becomes just the ingredient.

If no item is found with the given UID, an error message is returned.

On success, the updated item is returned as a markdown card.

## Example

Mark an item as purchased and update quantity:

```json
{
  "name": "update_grocery_item",
  "arguments": {
    "uid": "B2C3D4E5-F6A7-8901-BCDE-F12345678901",
    "quantity": "3 lbs",
    "purchased": true
  }
}
```

## Sample output

```text
# Butter
**UID:** `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
**List UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Quantity:** 3 lbs
**Aisle:** Dairy
**Purchased:** Yes
```
