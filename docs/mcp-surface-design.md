# MCP Surface Design: Tools vs Resources

Decision matrix and heuristic for determining whether each Paprika entity type
is exposed as an MCP tool, an MCP resource, or both.

## Heuristic

**Would a user attach this entity into a conversation to discuss it?**

- **Yes** → **Content** class. Resource surface (list + URI template) with rich
  rendering. Plus tools for model-driven read, query, and mutation.
- **No, but the model needs to query/mutate individual records** → **Data**
  class. Tools only (list, get, write ops). No resource surface.
- **No, it's organizational lookup data** → **Reference** class. Single list
  tool. No individual read, no CRUD, no resource.

**Tiebreaker for ambiguous entities:** if the entity is a container (has
children) or a standalone document (rich enough to read on its own), it's
Content. If it's a row in a table (meaningful only in aggregate or as part of
a container), it's Data.

### Why this heuristic

MCP resources and tools serve different invocation paths. Resources require user
action — attaching via `@` in Claude Code or the attach UI in Claude Desktop.
The model cannot autonomously access resources; it uses tools for that. So a
`read_recipe` tool is not redundant with `paprika://recipe/{uid}` — the tool
handles model-driven retrieval, the resource handles user-driven context
injection.

Data-class entities (pantry items, grocery items, meal entries) are too granular
for a user to attach individually. The model accesses them via list/get tools,
which is sufficient. Exposing them as resources adds maintenance cost and
duplicates the tool output with no consumer benefit.

Reference-class entities (categories, aisles) exist so the model can resolve
display names to UIDs when creating or filtering other entities. They need no
individual read, no CRUD, and no resource surface.

## Decision Matrix

| Entity       | Class     | Resource                       | Tool Surface                                                                                                                                                     |
| ------------ | --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe       | Content   | `paprika://recipe/{uid}`       | `list_recipes`, `read_recipe`, `search_recipes`, `filter_by_ingredient`, `filter_by_time`, `discover_recipes`, `create_recipe`, `update_recipe`, `delete_recipe` |
| Category     | Reference | —                              | `list_categories`                                                                                                                                                |
| Pantry item  | Data      | —                              | `list_pantry`, `get_pantry_item`, `add_pantry_item`, `update_pantry_item`, `delete_pantry_item`                                                                  |
| Grocery list | Content   | `paprika://grocery-list/{uid}` | `list_grocery_lists`, `read_grocery_list`, `create_grocery_list`, `delete_grocery_list`                                                                          |
| Grocery item | Data      | —                              | `list_grocery_items`, `add_grocery_item`, `update_grocery_item`, `delete_grocery_item`, `check_grocery_item`                                                     |
| Aisle        | Reference | —                              | `list_aisles`                                                                                                                                                    |
| Menu         | Content   | `paprika://menu/{uid}`         | `list_menus`, `read_menu`, `create_menu`, `update_menu`, `delete_menu`                                                                                           |
| Meal entry   | Data      | —                              | `list_meals` (with date/recipe filters), `add_meal`, `delete_meal`                                                                                               |

## Resource Rendering Contract

Resources are richer than tool output. The two paths serve different consumers:

**Tool output** returns clean, action-oriented markdown — the recipe text, the
list items, the menu contents. The model already has the UID in its call chain
and doesn't need it echoed back.

**Resource output** prepends a metadata header:

```
**UID:** `<uid>`
**URI:** `paprika://<entity>/<uid>`
**Last synced:** <timestamp>
```

For container Content entities (grocery lists, menus), the resource inlines all
child items so a single resource read gives the user complete context to discuss.

## Audit of Existing Surface

| Entity      | Current Surface        | Matrix                | Status                                                                          |
| ----------- | ---------------------- | --------------------- | ------------------------------------------------------------------------------- |
| Recipe      | Tools + resource       | Content → both        | Conforming. Resource metadata header includes UID, URI, Last synced, and Photo. |
| Category    | `list_categories` tool | Reference → list tool | Conforming. No change.                                                          |
| Aisle       | `list_aisles` tool     | Reference → list tool | Conforming. No change.                                                          |
| Pantry item | Tools only             | Data → tools only     | Conforming. `paprika://pantry/{uid}` resource retired (#104).                   |

Grocery lists, grocery items, menus, and meal entries do not exist yet
and will be built to the matrix from the start.
