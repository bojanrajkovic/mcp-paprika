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

## Sample output

```text
# Chicken Parmesan
**Categories:** Italian, Dinner

A classic Italian-American comfort dish with crispy breaded chicken, marinara sauce, and melted mozzarella.

Prep: 20 min · Cook: 30 min · Total: 50 min
**Servings:** 4

## Ingredients
2 boneless skinless chicken breasts
1 cup breadcrumbs
1/2 cup grated Parmesan cheese
1 egg, beaten
2 cups marinara sauce
1 cup shredded mozzarella
Salt and pepper to taste

## Directions
1. Preheat oven to 400°F. Pound chicken to even thickness.
2. Mix breadcrumbs and Parmesan. Dip chicken in egg, then breadcrumb mixture.
3. Pan-fry in olive oil until golden, about 3 minutes per side.
4. Transfer to baking dish. Top with marinara and mozzarella.
5. Bake 20 minutes until cheese is bubbly.

## Notes
Use room-temperature eggs for best results.
```
