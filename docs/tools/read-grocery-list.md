# read_grocery_list

Get a grocery list by UID or name, returning the list metadata and all its items.

## Parameters

| Name     | Type   | Required | Description                                                       |
| -------- | ------ | -------- | ----------------------------------------------------------------- |
| `lookup` | object | Yes      | Pick exactly one shape: `{ "uid": "..." }` or `{ "name": "..." }` |

The `lookup` value is one of:

- `{ "uid": "..." }` — exact grocery list UID
- `{ "name": "..." }` — grocery list name (tiered fuzzy match)

Pass exactly one shape. Supplying both keys, or neither, is rejected at the schema boundary — there is no precedence fallback.

## Behavior

Name lookup is tiered and case-insensitive: exact match is tried first, then starts-with, then contains. When multiple lists match at the same tier, a disambiguation list is returned with all matching names and UIDs — re-invoke with a specific `uid` to proceed.

If no list is found, an error message is returned.

## Examples

By UID:

```json
{
  "name": "read_grocery_list",
  "arguments": {
    "lookup": { "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890" }
  }
}
```

By name (fuzzy):

```json
{
  "name": "read_grocery_list",
  "arguments": {
    "lookup": { "name": "weekly" }
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
