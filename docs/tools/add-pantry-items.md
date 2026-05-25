# add_pantry_items

Add one or more items to the pantry in a single batch.

## Parameters

| Name                     | Type    | Required | Default | Description                                                                                                   |
| ------------------------ | ------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `items`                  | array   | Yes      | —       | Array of items to add (1 or more)                                                                             |
| `items[].ingredient`     | string  | Yes      | —       | Ingredient name (required)                                                                                    |
| `items[].quantity`       | string  | No       | `""`    | Quantity, e.g. `"1 lb"`                                                                                       |
| `items[].aisle`          | string  | No       | `""`    | Aisle display name; call `list_aisles` first to pick an existing name. Unknown names auto-create a new aisle. |
| `items[].expirationDate` | string  | No       | `null`  | Expiration date as ISO 8601 or Paprika wire format; sets `hasExpiration = true`                               |
| `items[].purchaseDate`   | string  | No       | today   | Purchase date; defaults to today at midnight in Paprika wire format                                           |
| `items[].inStock`        | boolean | No       | `true`  | Whether the item is currently in stock                                                                        |
| `items[].notes`          | string  | No       | `null`  | Free-form notes                                                                                               |

## Behavior

**Date validation is all-or-nothing.** All dates in the batch are parsed before any API calls. If any `expirationDate` or `purchaseDate` is unparseable, the entire batch is rejected with an error identifying the offending item by index and ingredient name. Accepted formats: ISO 8601 (`2026-12-31`), or the Paprika wire format (`2026-12-31 00:00:00`).

**Duplicate detection is skip-and-report.** Items that match an existing pantry item by ingredient name (case-insensitive) are skipped — not rejected. Intra-batch duplicates (two items with the same ingredient in one call) are also skipped. The response includes a skip report with the existing UID and a suggestion to use `update_pantry_item` to merge quantities. If all items are duplicates, no API call is made.

**Aisle resolution:** each item's aisle name is resolved to an `aisleUid`. If the aisle does not exist, it is auto-created. Repeated aisle names within a single batch resolve via a cache, so `ensureAisle` is called at most once per unique aisle name regardless of how many items share that aisle.

All items are sent to Paprika in a single batch POST after validation.

On success, the number of items added is reported along with a rendered markdown card for each new item. Any skipped duplicates are listed separately.

## Examples

Single item with defaults:

```json
{
  "name": "add_pantry_items",
  "arguments": {
    "items": [{ "ingredient": "Butter" }]
  }
}
```

Multiple items with optional fields:

```json
{
  "name": "add_pantry_items",
  "arguments": {
    "items": [
      { "ingredient": "Apples", "quantity": "6", "aisle": "Produce" },
      { "ingredient": "Milk", "quantity": "1 gallon", "aisle": "Dairy", "expirationDate": "2026-06-15" },
      { "ingredient": "Eggs", "quantity": "1 dozen", "inStock": false, "notes": "need to restock" }
    ]
  }
}
```

## Sample output

```text
Added 2 item(s) to the pantry.

# Apples
**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Quantity:** 6
**Aisle:** Produce
**In stock:** Yes

---

# Milk
**UID:** `B2C3D4E5-F6A7-8901-BCDE-F12345678901`
**Quantity:** 1 gallon
**Aisle:** Dairy
**In stock:** Yes
**Expires:** 2026-06-15 00:00:00

---

**Skipped (duplicates):**
Skipped "Eggs" (item 2): already exists (UID: C3D4E5F6-...). Use update_pantry_item with this UID to merge quantities.
```
