# read_recipe

Read a recipe by UID or title. Returns the full recipe with ingredients, directions, notes, and metadata.

## Parameters

| Name    | Type   | Required | Default | Description                |
| ------- | ------ | -------- | ------- | -------------------------- |
| `uid`   | string | No       | —       | Exact recipe UID           |
| `title` | string | No       | —       | Recipe title (fuzzy match) |

At least one of `uid` or `title` must be provided. When both are given, `uid` takes precedence.

## Behavior

**UID lookup** returns the exact recipe or an error if not found.

**Title lookup** uses fuzzy matching in three tiers:

1. Exact match (case-insensitive)
2. Starts with the query
3. Contains the query anywhere in the title

If multiple recipes match at the same tier, a disambiguation list is returned instead of a single recipe. The list includes UIDs so you can follow up with an exact UID lookup.

## Examples

By UID (from a previous search or list result):

```json
{
  "name": "read_recipe",
  "arguments": {
    "uid": "ABC123-DEF456"
  }
}
```

By title:

```json
{
  "name": "read_recipe",
  "arguments": {
    "title": "chicken parmesan"
  }
}
```

## Sample output

```text
# Chicken Parmesan
**Categories:** Italian, Dinner

A classic Italian-American comfort dish with crispy breaded chicken, marinara sauce, and melted mozzarella.

Prep: 20 min · Cook: 30 min · Total: 50 min
**Servings:** 4

## Ingredients
2 boneless skinless chicken breasts
1 cup breadcrumbs
1/2 cup grated Parmesan cheese
1 egg, beaten
2 cups marinara sauce
1 cup shredded mozzarella
Salt and pepper to taste

## Directions
1. Preheat oven to 400°F. Pound chicken to even thickness.
2. Mix breadcrumbs and Parmesan. Dip chicken in egg, then breadcrumb mixture.
3. Pan-fry in olive oil until golden, about 3 minutes per side.
4. Transfer to baking dish. Top with marinara and mozzarella.
5. Bake 20 minutes until cheese is bubbly.

## Notes
Leftovers keep in the fridge for 3 days. Reheat in the oven to keep the coating crispy.

**Source:** [Serious Eats](https://www.seriouseats.com/chicken-parmesan)
```
