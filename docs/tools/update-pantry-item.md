# update_pantry_item

Update an existing pantry item by UID. Only provided fields are changed; omitted fields retain their existing values.

## Parameters

| Name             | Type           | Required | Default   | Description                                                                                                            |
| ---------------- | -------------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `uid`            | string         | Yes      | —         | Pantry item UID to update                                                                                              |
| `ingredient`     | string         | No       | unchanged | New ingredient name                                                                                                    |
| `quantity`       | string         | No       | unchanged | New quantity; set to `""` to clear                                                                                     |
| `aisle`          | string         | No       | unchanged | New aisle display name; unknown names auto-create a new aisle                                                          |
| `expirationDate` | string \| null | No       | unchanged | Set expiration date (ISO 8601 or Paprika wire format); pass `null` to clear. `hasExpiration` is derived automatically. |
| `purchaseDate`   | string \| null | No       | unchanged | Set purchase date; pass `null` to clear                                                                                |
| `inStock`        | boolean        | No       | unchanged | Set in-stock status                                                                                                    |
| `notes`          | string \| null | No       | unchanged | Set notes; pass `null` to clear                                                                                        |

## Behavior

Performs a partial merge — only fields explicitly provided in the call are updated.

`hasExpiration` is **always derived** from `expirationDate`: if `expirationDate` is set to a date string, `hasExpiration` becomes `true`; if set to `null`, `hasExpiration` becomes `false`. There is no way to set `hasExpiration` directly.

**Date normalization:** user-supplied date strings are normalized to Paprika wire format (`yyyy-MM-dd HH:mm:ss`). Accepted formats: ISO 8601 (`2026-12-31`), or the Paprika wire format directly.

**Aisle resolution:** when `aisle` is provided, the name is resolved to an `aisleUid`. Unknown aisle names are auto-created.

Requires the pantry to be synced (returns an error if called before the first sync cycle completes).

## Example

```json
{
  "name": "update_pantry_item",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    "quantity": "3 lbs",
    "inStock": true,
    "expirationDate": "2026-12-31"
  }
}
```

## Sample output

```text
# Butter
**UID:** `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`
**Quantity:** 3 lbs
**Aisle:** Dairy
**In stock:** Yes
**Expires:** 2026-12-31 00:00:00
```
