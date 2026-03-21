# update_recipe

Update an existing recipe by UID. Only provided fields are changed — omitted fields keep their current values.

## Parameters

| Name              | Type     | Required | Default | Description                                   |
| ----------------- | -------- | -------- | ------- | --------------------------------------------- |
| `uid`             | string   | Yes      | —       | Recipe UID to update                          |
| `name`            | string   | No       | —       | New recipe name                               |
| `ingredients`     | string   | No       | —       | New ingredients list                          |
| `directions`      | string   | No       | —       | New cooking directions                        |
| `description`     | string   | No       | —       | New description                               |
| `notes`           | string   | No       | —       | New notes                                     |
| `servings`        | string   | No       | —       | New servings                                  |
| `prepTime`        | string   | No       | —       | New prep time                                 |
| `cookTime`        | string   | No       | —       | New cook time                                 |
| `totalTime`       | string   | No       | —       | New total time                                |
| `categories`      | string[] | No       | —       | Category display names (replaces entire list) |
| `source`          | string   | No       | —       | New source name                               |
| `sourceUrl`       | string   | No       | —       | New source URL                                |
| `difficulty`      | string   | No       | —       | New difficulty level                          |
| `rating`          | integer  | No       | —       | New rating 0-5                                |
| `nutritionalInfo` | string   | No       | —       | New nutritional information                   |

## Behavior

This is a partial update — only include the fields you want to change. The `uid` field identifies which recipe to update.

**Categories are the exception.** If you include `categories`, it replaces the entire category list. Omitting `categories` leaves the existing list unchanged. Passing an empty array `[]` removes all categories.

Category names are resolved case-insensitively, same as `create_recipe`. Unknown categories are skipped with warnings.

## Examples

Update just the rating:

```json
{
  "name": "update_recipe",
  "arguments": {
    "uid": "ABC123-DEF456",
    "rating": 5
  }
}
```

Fix the ingredients and add a note:

```json
{
  "name": "update_recipe",
  "arguments": {
    "uid": "ABC123-DEF456",
    "ingredients": "2 cups flour\n1 cup sugar\n3 eggs\n1 cup milk",
    "notes": "Use room-temperature eggs for best results."
  }
}
```
