# read_recipe

Read a recipe by UID or title. Returns the full recipe with ingredients, directions, notes, and metadata.

## Parameters

| Name    | Type   | Required | Default | Description                |
| ------- | ------ | -------- | ------- | -------------------------- |
| `uid`   | string | No       | —       | Exact recipe UID           |
| `title` | string | No       | —       | Recipe title (fuzzy match) |

At least one of `uid` or `title` must be provided. When both are given, `uid` takes precedence.

## Behavior

**UID lookup** returns the exact recipe or an error if not found.

**Title lookup** uses fuzzy matching in three tiers:

1. Exact match (case-insensitive)
2. Starts with the query
3. Contains the query anywhere in the title

If multiple recipes match at the same tier, a disambiguation list is returned instead of a single recipe. The list includes UIDs so you can follow up with an exact UID lookup.

## Examples

By UID (from a previous search or list result):

```json
{
  "name": "read_recipe",
  "arguments": {
    "uid": "ABC123-DEF456"
  }
}
```

By title:

```json
{
  "name": "read_recipe",
  "arguments": {
    "title": "chicken parmesan"
  }
}
```
