# Tools reference

mcp-paprika exposes 10 MCP tools. Each page below covers parameters, behavior, and examples.

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
