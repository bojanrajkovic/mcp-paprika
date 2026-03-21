# search_recipes

Search for recipes by name, ingredients, or description. Returns a ranked list of matching recipes.

## Parameters

| Name    | Type    | Required | Default | Description               |
| ------- | ------- | -------- | ------- | ------------------------- |
| `query` | string  | Yes      | —       | Search query text         |
| `limit` | integer | No       | 20      | Maximum results (max: 50) |

## Behavior

Results are ranked using tiered scoring:

1. **Exact match** — recipe name matches the query exactly (case-insensitive)
2. **Starts with** — recipe name starts with the query
3. **Contains** — query appears anywhere in the recipe name, ingredients, or description

Within each tier, results are sorted alphabetically. The response includes category names and timing info for each recipe.

## Example

```json
{
  "name": "search_recipes",
  "arguments": {
    "query": "chicken parmesan",
    "limit": 5
  }
}
```
