# get_pantry_item

Get a pantry item by UID or ingredient name.

## Parameters

| Name         | Type   | Required | Default | Description                   |
| ------------ | ------ | -------- | ------- | ----------------------------- |
| `uid`        | string | No       | —       | Exact pantry item UID         |
| `ingredient` | string | No       | —       | Ingredient name (fuzzy match) |

At least one of `uid` or `ingredient` must be provided.

## Behavior

When both `uid` and `ingredient` are provided, `uid` takes precedence and the ingredient is ignored.

**UID lookup** is exact — returns the item with that UID or a not-found message.

**Ingredient lookup** uses tiered fuzzy matching: exact match → starts-with → contains. Only one tier is returned. If a single item matches, the full item card is returned. If multiple items match the same tier, a disambiguation list is returned with each matching ingredient and UID — re-invoke with the specific UID to get the full card.

Requires the pantry to be synced (returns an error if called before the first sync cycle completes).

## Examples

By UID:

```json
{
  "name": "get_pantry_item",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

By ingredient name:

```json
{
  "name": "get_pantry_item",
  "arguments": {
    "ingredient": "butter"
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
