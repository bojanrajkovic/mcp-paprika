# list_categories

List all recipe categories with the number of recipes in each. Categories are sorted alphabetically.

## Parameters

None.

## Behavior

Returns every category in your Paprika account, including categories with zero recipes. Recipe counts exclude trashed recipes.

## Example

```json
{
  "name": "list_categories",
  "arguments": {}
}
```

## Sample output

```text
## Recipe Categories

- **Asian** (12 recipes)
- **Breakfast** (8 recipes)
- **Casseroles** (5 recipes)
- **Comfort Food** (17 recipes)
- **Desserts** (14 recipes)
- **Dinner** (32 recipes)
- **Italian** (9 recipes)
- **Pasta** (7 recipes)
- **Quick Meals** (11 recipes)
- **Soups** (6 recipes)
- **Vegetarian** (1 recipe)
```
