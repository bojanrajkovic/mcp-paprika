# create_grocery_list

Create a new grocery list with the given name.

## Parameters

| Name   | Type   | Required | Default | Description                  |
| ------ | ------ | -------- | ------- | ---------------------------- |
| `name` | string | Yes      | —       | Grocery list name (required) |

## Behavior

The list is saved to your Paprika cloud account and synced to the local cache. A new UUID is assigned automatically.

Duplicate names are rejected using a case-insensitive exact match. If a list with the same name already exists, the response includes the existing UID so you can use it directly. Starts-with or contains matches are not considered duplicates — only an exact case-insensitive match triggers the rejection.

On success, the newly created (empty) list is returned in markdown format.

## Example

```json
{
  "name": "create_grocery_list",
  "arguments": {
    "name": "Weekly Groceries"
  }
}
```

## Sample output

```text
# Weekly Groceries

**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Items:** 0

No items in this list yet.
```
