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
