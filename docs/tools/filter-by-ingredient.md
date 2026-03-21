# filter_by_ingredient

Filter recipes by ingredient. Use `mode="all"` (default) to require all ingredients, or `mode="any"` to match any.

## Parameters

| Name          | Type               | Required    | Default | Description                                                     |
| ------------- | ------------------ | ----------- | ------- | --------------------------------------------------------------- |
| `ingredients` | string[]           | Yes (min 1) | —       | One or more ingredient terms to filter by                       |
| `mode`        | `"all"` or `"any"` | No          | `"all"` | `"all"` requires every ingredient; `"any"` matches at least one |
| `limit`       | integer            | No          | 20      | Maximum results (max: 50)                                       |

## Behavior

Ingredient matching is case-insensitive and checks if the term appears anywhere in a recipe's ingredient list. For example, `"chicken"` matches `"boneless skinless chicken breast"`.

- **`"all"` mode** — recipe must contain every ingredient term (AND logic)
- **`"any"` mode** — recipe must contain at least one ingredient term (OR logic)

## Examples

Find recipes that use both chicken and rice:

```json
{
  "name": "filter_by_ingredient",
  "arguments": {
    "ingredients": ["chicken", "rice"],
    "mode": "all"
  }
}
```

Find recipes that use either chocolate or vanilla:

```json
{
  "name": "filter_by_ingredient",
  "arguments": {
    "ingredients": ["chocolate", "vanilla"],
    "mode": "any",
    "limit": 10
  }
}
```
