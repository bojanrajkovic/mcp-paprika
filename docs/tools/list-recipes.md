# list_recipes

List all recipes with pagination. Returns recipe summaries sorted alphabetically.

## Parameters

| Name     | Type    | Required | Default | Description                         |
| -------- | ------- | -------- | ------- | ----------------------------------- |
| `offset` | integer | No       | 0       | Number of recipes to skip           |
| `limit`  | integer | No       | 25      | Maximum recipes to return (max: 50) |

## Behavior

Results are sorted alphabetically by recipe name. Each entry includes category names in brackets and basic metadata. The response header shows `"Showing X of Y recipes"` so you know how many remain.

Trashed recipes are excluded.

## Examples

First page:

```json
{
  "name": "list_recipes",
  "arguments": {}
}
```

Second page:

```json
{
  "name": "list_recipes",
  "arguments": {
    "offset": 25,
    "limit": 25
  }
}
```

## Sample output

```text
Showing 4 of 122 recipes (offset: 0):

- **Chicken Parmesan** [Italian, Dinner] (uid: a1b2c3d4-e5f6-7890-abcd-ef1234567890)
- **Pasta Aglio e Olio** [Italian, Pasta, Quick Meals] (uid: b2c3d4e5-f6a7-8901-bcde-f12345678901)
- **Roasted Tomato Soup** [Soups, Comfort Food] (uid: c3d4e5f6-a7b8-9012-cdef-123456789012)
- **Shakshuka** [Breakfast, Vegetarian] (uid: d4e5f6a7-b8c9-0123-defa-234567890123)
```
