# Tools reference

mcp-paprika exposes 43 MCP tools. Two are feature-gated and register only when configured: `discover_recipes` (an embedding provider) and `generate_photo` (an image-generation provider). Each page below covers parameters, behavior, and examples.

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

| Tool                                | Description                                                               |
| ----------------------------------- | ------------------------------------------------------------------------- |
| [read_recipe](read-recipe.md)       | Read a recipe by UID or fuzzy title match                                 |
| [create_recipe](create-recipe.md)   | Create a new recipe                                                       |
| [update_recipe](update-recipe.md)   | Update an existing recipe (partial updates)                               |
| [delete_recipe](delete-recipe.md)   | Soft-delete a recipe (moves to Paprika trash)                             |
| [empty_trash](empty-trash.md)       | Permanently delete an already-trashed recipe (irreversible; guarded)      |
| [generate_photo](generate-photo.md) | Generate an AI food photo for a recipe and attach it (requires image-gen) |

## Pantry and aisle management

| Tool                                        | Description                                           |
| ------------------------------------------- | ----------------------------------------------------- |
| [list_aisles](list-aisles.md)               | List all aisles sorted by order flag then name        |
| [list_pantry](list-pantry.md)               | List all pantry items sorted alphabetically           |
| [get_pantry_item](get-pantry-item.md)       | Get a pantry item by UID or fuzzy ingredient name     |
| [add_pantry_items](add-pantry-items.md)     | Add one or more items to the pantry in a single batch |
| [update_pantry_item](update-pantry-item.md) | Update an existing pantry item (partial updates)      |
| [delete_pantry_item](delete-pantry-item.md) | Soft-delete a pantry item by UID                      |

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

## Meal planner management

| Tool                                          | Description                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| [list_meal_history](list-meal-history.md)     | Calendar-style view of planned meals grouped by date, with filters and pagination |
| [list_meal_types](list-meal-types.md)         | List built-in and custom meal types (name → UID) — read-only catalog              |
| [add_meals](add-meals.md)                     | Add one or more meals to the planner in a single batch with per-index validation  |
| [update_meal](update-meal.md)                 | Partial-merge update for a single meal (date, type, recipe link, scale)           |
| [delete_meal](delete-meal.md)                 | Soft-delete a meal by UID; idempotent                                             |
| [add_menu_to_planner](add-menu-to-planner.md) | Instantiate a saved menu's recipes as dated planner meals (one-way copy)          |

## Menu management

| Tool                                    | Description                                                           |
| --------------------------------------- | --------------------------------------------------------------------- |
| [list_menus](list-menus.md)             | List all menus in Paprika order, with item count and day span         |
| [read_menu](read-menu.md)               | Read a menu by UID or name, rendered day by day with item/recipe UIDs |
| [create_menu](create-menu.md)           | Create a new menu (name, day span, notes); rejects duplicate names    |
| [update_menu](update-menu.md)           | Update a menu's name, day span, and/or notes                          |
| [delete_menu](delete-menu.md)           | Delete a menu and cascade-delete its planned recipes                  |
| [add_menu_items](add-menu-items.md)     | Add recipe-linked menuitems in a batch; auto-extends the menu span    |
| [update_menu_item](update-menu-item.md) | Update a menuitem's day, meal type, or linked recipe                  |
| [delete_menu_item](delete-menu-item.md) | Soft-delete a single menuitem by UID; idempotent                      |
