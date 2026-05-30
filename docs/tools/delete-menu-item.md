# delete_menu_item

Soft-delete a menuitem (a planned recipe) from a menu by UID. The operation is idempotent: a second delete on the same UID returns "already deleted" without re-POSTing.

## Parameters

| Name  | Type   | Required | Default | Description              |
| ----- | ------ | -------- | ------- | ------------------------ |
| `uid` | string | Yes      | —       | Menu item UID to delete. |

## Behavior

Marks the menuitem as `deleted: true` on the Paprika server, removes it from the local store, and tombstones the UID in-session so retries are short-circuited. The deletion propagates to all Paprika clients on the next sync.

**Idempotent.** A tombstoned UID returns `Menu item with UID "<uid>" is already deleted.`; a UID never seen returns `No menu item found with UID "<uid>".`

Requires an **exact** UID — there is no name lookup (find the UID via `read_menu`, whose lines carry each item's UID).

**Sync requirement.** The menu, menu-item, and meal-type stores must all be synced (`menuStartGuard`). On a Paprika API failure the tool returns `Failed to delete menu item: <message>`.

## Example

```json
{
  "name": "delete_menu_item",
  "arguments": {
    "uid": "E5F6A7B8-C9D0-1234-EFA0-345678901234"
  }
}
```

## Sample output

```text
Menu item "Beef Stew" has been deleted.
```
