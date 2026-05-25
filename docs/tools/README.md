# Tools reference

mcp-paprika exposes 21 MCP tools. Each page below covers parameters, behavior, and examples.

## Discovery and query

| Tool                                            | Description                                                    |
| ----------------------------------------------- | -------------------------------------------------------------- |
| [search_recipes](search-recipes.md)             | Text search across recipe names, ingredients, and descriptions |
| [filter_by_ingredient](filter-by-ingredient.md) | Filter recipes by one or more ingredients (AND/OR)             |
| [filter_by_time](filter-by-time.md)             | Filter recipes by prep, cook, or total time                    |
| [discover_recipes](discover-recipes.md)         | Semantic search using natural language (requires embeddings)   |
| [list_categories](list-categories.md)           | List all categories with recipe counts                         |
| [list_recipes](list-recipes.md)                 | Paginated alphabetical recipe list                             |

## Recipe management

| Tool                              | Description                                   |
| --------------------------------- | --------------------------------------------- |
| [read_recipe](read-recipe.md)     | Read a recipe by UID or fuzzy title match     |
| [create_recipe](create-recipe.md) | Create a new recipe                           |
| [update_recipe](update-recipe.md) | Update an existing recipe (partial updates)   |
| [delete_recipe](delete-recipe.md) | Soft-delete a recipe (moves to Paprika trash) |

## Grocery list management

| Tool                                          | Description                             |
| --------------------------------------------- | --------------------------------------- |
| [list_grocery_lists](list-grocery-lists.md)   | List all grocery lists with item counts |
| [read_grocery_list](read-grocery-list.md)     | Read a grocery list by UID or name      |
| [create_grocery_list](create-grocery-list.md) | Create a new grocery list               |
| [rename_grocery_list](rename-grocery-list.md) | Rename an existing grocery list         |
| [delete_grocery_list](delete-grocery-list.md) | Soft-delete a grocery list              |

## Grocery item management

| Tool                                          | Description                                        |
| --------------------------------------------- | -------------------------------------------------- |
| [add_grocery_items](add-grocery-items.md)     | Add one or more items to a grocery list            |
| [update_grocery_item](update-grocery-item.md) | Update a grocery item (quantity, aisle, purchased) |
| [delete_grocery_item](delete-grocery-item.md) | Soft-delete a grocery item                         |
| [move_to_pantry](move-to-pantry.md)           | Move grocery items to pantry (create-first order)  |
| [clear_purchased](clear-purchased.md)         | Clear all purchased items from a list              |
| [clear_all](clear-all.md)                     | Clear all items from a list                        |
