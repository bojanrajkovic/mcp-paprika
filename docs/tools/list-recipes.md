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
