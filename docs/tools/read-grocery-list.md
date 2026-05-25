# read_grocery_list

Get a grocery list by UID or name, returning the list metadata and all its items.

## Parameters

| Name   | Type   | Required | Default | Description                            |
| ------ | ------ | -------- | ------- | -------------------------------------- |
| `uid`  | string | No       | —       | Exact grocery list UID                 |
| `name` | string | No       | —       | Grocery list name (tiered fuzzy match) |

At least one of `uid` or `name` must be provided.

## Behavior

When both `uid` and `name` are provided, `uid` takes precedence and `name` is ignored.

Name lookup is tiered and case-insensitive: exact match is tried first, then starts-with, then contains. When multiple lists match at the same tier, a disambiguation list is returned with all matching names and UIDs — re-invoke with a specific `uid` to proceed.

If no list is found, an error message is returned.

## Examples

By UID:

```json
{
  "name": "read_grocery_list",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

By name (fuzzy):

```json
{
  "name": "read_grocery_list",
  "arguments": {
    "name": "weekly"
  }
}
```

## Sample output

```text
# Weekly Groceries

**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Items:** 3

| Ingredient | Quantity | Aisle   | Purchased |
| ---------- | -------- | ------- | --------- |
| Butter     | 2 lbs    | Dairy   | No        |
| Flour      | 5 lbs    | Baking  | No        |
| Milk       | 1 gal    | Dairy   | Yes       |
```
