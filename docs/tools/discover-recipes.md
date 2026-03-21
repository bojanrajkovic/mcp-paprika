# discover_recipes

Discover recipes using semantic search. Finds recipes matching a natural language description of what you're looking for.

This tool requires [embedding configuration](../embedding-providers.md). If embeddings aren't configured, the tool isn't registered and won't appear in the tool list.

## Parameters

| Name    | Type    | Required | Default | Description                                             |
| ------- | ------- | -------- | ------- | ------------------------------------------------------- |
| `query` | string  | Yes      | —       | Natural language description of what you're looking for |
| `topK`  | integer | No       | 5       | Maximum results (min: 1, max: 20)                       |

## Behavior

Unlike `search_recipes` which does keyword matching, `discover_recipes` understands meaning. Searching for `"something warm and comforting for a cold night"` will find soups, stews, and hot chocolate — even if those exact words don't appear in the recipes.

Results include a match percentage (cosine similarity score). Higher scores mean closer semantic matches.

Deleted/trashed recipes are filtered out of results.

## Examples

Find recipes by mood or occasion:

```json
{
  "name": "discover_recipes",
  "arguments": {
    "query": "quick healthy lunch for meal prep"
  }
}
```

Find recipes similar to a concept:

```json
{
  "name": "discover_recipes",
  "arguments": {
    "query": "Italian comfort food with lots of cheese",
    "topK": 10
  }
}
```

## How it works

Recipes are embedded using their name, description, categories, ingredients, and notes (directions and nutritional info are excluded). The query is embedded and compared against stored recipe vectors using cosine similarity.

The vector index updates automatically when recipes are added, updated, or deleted via sync. See [architecture](../architecture.md#semantic-search) for details.

## Sample output

```text
1. **Roasted Tomato Soup** — 94% match
   **Categories:** Soups, Comfort Food
   Prep: 10 min · Cook: 40 min
   UID: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

2. **Beef and Barley Stew** — 91% match
   **Categories:** Soups, Dinner
   Prep: 15 min · Cook: 1 hr 30 min
   UID: `b2c3d4e5-f6a7-8901-bcde-f12345678901`

3. **Classic French Onion Soup** — 88% match
   **Categories:** Soups, French
   Prep: 20 min · Cook: 1 hr
   UID: `c3d4e5f6-a7b8-9012-cdef-123456789012`
```
