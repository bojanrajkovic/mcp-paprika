# get_pantry_item

Get a pantry item by UID or ingredient name.

## Parameters

| Name     | Type   | Required | Description                                                             |
| -------- | ------ | -------- | ----------------------------------------------------------------------- |
| `lookup` | object | Yes      | Pick exactly one shape: `{ "uid": "..." }` or `{ "ingredient": "..." }` |

The `lookup` value is one of:

- `{ "uid": "..." }` — exact pantry item UID
- `{ "ingredient": "..." }` — ingredient name (fuzzy match)

Pass exactly one shape. Supplying both keys, or neither, is rejected at the schema boundary — there is no precedence fallback.

## Behavior

**UID lookup** is exact — returns the item with that UID or a not-found message.

**Ingredient lookup** uses tiered fuzzy matching: exact match → starts-with → contains. Only one tier is returned. If a single item matches, the full item card is returned. If multiple items match the same tier, a disambiguation list is returned with each matching ingredient and UID — re-invoke with the specific UID to get the full card.

Requires the pantry to be synced (returns an error if called before the first sync cycle completes).

## Examples

By UID:

```json
{
  "name": "get_pantry_item",
  "arguments": {
    "lookup": { "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890" }
  }
}
```

By ingredient name:

```json
{
  "name": "get_pantry_item",
  "arguments": {
    "lookup": { "ingredient": "butter" }
  }
}
```

## Sample output

```text
# Butter
**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Quantity:** 2 lbs
**Aisle:** Dairy
**In stock:** Yes
**Purchased:** 2026-05-01 00:00:00
```
