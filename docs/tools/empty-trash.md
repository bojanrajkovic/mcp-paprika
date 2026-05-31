# empty_trash

Permanently delete a recipe that is already in the Paprika trash.

## Parameters

| Name  | Type   | Required | Default | Description                                   |
| ----- | ------ | -------- | ------- | --------------------------------------------- |
| `uid` | string | Yes      | —       | UID of a trashed recipe to permanently delete |

## Behavior

This is a **hard delete** — it empties the recipe from Paprika's trash, and the recipe cannot be recovered afterward. It is the irreversible counterpart to `delete_recipe`.

To prevent accidental data loss, `empty_trash` only acts on recipes that are **already in the trash**. If you call it on a live recipe, it refuses and tells you to move the recipe to the trash first with `delete_recipe` (which is reversible). So permanently destroying a live recipe always takes two deliberate steps — exactly like Paprika's own "Empty Trash" action.

Only exact UIDs are accepted; there is no fuzzy title matching, by design. Use `read_recipe` or `search_recipes` to find a UID.

The call is idempotent: running it again on a recipe that has already been purged returns a "no recipe found" message rather than an error.

## Example

```json
{
  "name": "empty_trash",
  "arguments": {
    "uid": "ABC123-DEF456"
  }
}
```

## Sample output

```text
Recipe "Chicken Parmesan" has been permanently deleted from the trash.
```

If the recipe is not in the trash:

```text
Recipe "Chicken Parmesan" is not in the trash, so it can't be permanently deleted. Move it to the trash first with delete_recipe (reversible), then call empty_trash.
```
