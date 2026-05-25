# add_grocery_items

Add one or more items to a grocery list in a single batch.

## Parameters

| Name                  | Type   | Required | Default | Description                                                      |
| --------------------- | ------ | -------- | ------- | ---------------------------------------------------------------- |
| `listUid`             | string | Yes      | —       | UID of the grocery list to add items to                          |
| `items`               | array  | Yes      | —       | Array of items to add (1 or more)                                |
| `items[].ingredient`  | string | Yes      | —       | Ingredient name (required)                                       |
| `items[].quantity`    | string | No       | —       | Quantity, e.g. `"2 lbs"`                                         |
| `items[].aisle`       | string | No       | —       | Aisle display name; omit to auto-resolve from ingredient catalog |
| `items[].instruction` | string | No       | —       | Free-form notes for this item                                    |

## Behavior

Before calling this tool, use `read_grocery_list` to check for existing items with the same ingredient — consolidate quantities rather than creating duplicates. There is no server-side duplicate guard.

All items in the batch are validated before any API calls are made (all-or-nothing). If any item fails validation (e.g., empty ingredient), no items are added.

**Aisle resolution:** when `aisle` is omitted, the aisle is auto-resolved from the ingredient catalog. When `aisle` is provided explicitly, the catalog entry for that ingredient is created or updated so future auto-resolves pick up the new aisle.

**Name denormalization:** each item's internal `name` field is stored as `"quantity ingredient"` when quantity is non-empty, or just `"ingredient"` when quantity is empty.

All items are sent to Paprika in a single batch POST.

On success, the number of items added is reported along with a rendered markdown card for each new item.

## Examples

Single item with quantity:

```json
{
  "name": "add_grocery_items",
  "arguments": {
    "listUid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "items": [{ "ingredient": "Butter", "quantity": "2 lbs", "aisle": "Dairy" }]
  }
}
```

Multiple items:

```json
{
  "name": "add_grocery_items",
  "arguments": {
    "listUid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "items": [
      { "ingredient": "Butter", "quantity": "2 lbs" },
      { "ingredient": "Eggs", "quantity": "1 dozen", "aisle": "Dairy" },
      { "ingredient": "Bread", "instruction": "Sourdough preferred" }
    ]
  }
}
```

## Sample output

```text
Added 2 item(s) to the grocery list.

# Butter
**UID:** `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
**List UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Quantity:** 2 lbs
**Aisle:** Dairy
**Purchased:** No

---

# Eggs
**UID:** `C3D4E5F6-A7B8-9012-CDEF-123456789012`
**List UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Quantity:** 1 dozen
**Aisle:** Dairy
**Purchased:** No
```
