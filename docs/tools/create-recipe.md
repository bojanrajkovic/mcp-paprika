# create_recipe

Create a new recipe in your Paprika account.

## Parameters

| Name              | Type     | Required | Default | Description                               |
| ----------------- | -------- | -------- | ------- | ----------------------------------------- |
| `name`            | string   | Yes      | —       | Recipe name                               |
| `ingredients`     | string   | Yes      | —       | Ingredients list                          |
| `directions`      | string   | Yes      | —       | Cooking directions                        |
| `description`     | string   | No       | —       | Brief description                         |
| `notes`           | string   | No       | —       | Additional notes                          |
| `servings`        | string   | No       | —       | Number of servings                        |
| `prepTime`        | string   | No       | —       | Prep time (e.g., `"15 min"`)              |
| `cookTime`        | string   | No       | —       | Cook time (e.g., `"30 min"`)              |
| `totalTime`       | string   | No       | —       | Total time (e.g., `"45 min"`)             |
| `categories`      | string[] | No       | —       | Category display names (case-insensitive) |
| `source`          | string   | No       | —       | Source name                               |
| `sourceUrl`       | string   | No       | —       | Source URL                                |
| `difficulty`      | string   | No       | —       | Difficulty level                          |
| `rating`          | integer  | No       | 0       | Rating 0-5                                |
| `nutritionalInfo` | string   | No       | —       | Nutritional information                   |

## Behavior

The recipe is saved to your Paprika cloud account and synced to the local cache. A new UUID is assigned automatically.

Category names are resolved case-insensitively against your existing categories. If a category name doesn't match any existing category, it's skipped and a warning is included in the response. You need to create categories in the Paprika app first.

## Example

```json
{
  "name": "create_recipe",
  "arguments": {
    "name": "Quick Pasta Aglio e Olio",
    "ingredients": "1 lb spaghetti\n6 cloves garlic, sliced\n1/2 cup olive oil\n1 tsp red pepper flakes\nFresh parsley\nParmesan cheese",
    "directions": "1. Cook pasta until al dente.\n2. Meanwhile, heat olive oil and cook garlic until golden.\n3. Add red pepper flakes.\n4. Toss drained pasta with garlic oil.\n5. Serve with parsley and parmesan.",
    "prepTime": "5 min",
    "cookTime": "15 min",
    "totalTime": "20 min",
    "servings": "4",
    "categories": ["Pasta", "Quick Meals"],
    "rating": 4
  }
}
```
