# delete_recipe

Soft-delete a recipe by UID, moving it to the Paprika trash.

## Parameters

| Name  | Type   | Required | Default | Description          |
| ----- | ------ | -------- | ------- | -------------------- |
| `uid` | string | Yes      | —       | Recipe UID to delete |

## Behavior

This is a soft delete — the recipe moves to Paprika's trash and can be recovered in the Paprika app. It's not permanently destroyed.

Only exact UIDs are accepted. There's no fuzzy title matching here, by design — accidental deletion of the wrong recipe is worse than having to look up a UID first. Use `search_recipes` or `read_recipe` to find the UID.

Already-trashed recipes can't be deleted again.

## Example

```json
{
  "name": "delete_recipe",
  "arguments": {
    "uid": "ABC123-DEF456"
  }
}
```
