import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { structuredResult } from "../../../shared/tools.js";
import { CategoryUidSchema } from "../ids.js";
import { categoryStartGuard } from "./guards.js";

// Structured-output payload (ADR-0019, R1): a flat array of category rows. The text
// renders the parent/child tree; the structured channel carries each `parentUid`
// (and `uid`) so the model can rebuild the hierarchy or drive category ops itself.
export const listCategoriesOutputSchema = z.object({
  items: z.array(
    z.object({
      uid: CategoryUidSchema,
      name: z.string(),
      recipeCount: z.number().int().nonnegative(),
      parentUid: CategoryUidSchema.nullable().describe("Parent category UID, or null for a top-level category."),
    }),
  ),
});

/**
 * Build the {@link listCategoriesOutputSchema} rows from the recipe state — name-sorted,
 * with each category's non-trashed recipe count and its parent FK (orphan parents
 * re-rooted to null, matching the text tree). Shared by `list_categories` and
 * `update_category` so the two echo the identical full-catalog shape.
 */
export function buildCategoryRows(state: RecipeState): z.infer<typeof listCategoriesOutputSchema>["items"] {
  const categories = state.category.store.getAll();
  const recipes = state.recipe.store.getAll();

  // Initialize every category with count 0 so categories with no recipes still appear.
  const countMap = new Map<string, number>();
  for (const category of categories) {
    countMap.set(category.uid, 0);
  }
  // Increment for each non-trashed recipe's categories (getAll() excludes trashed).
  for (const recipe of recipes) {
    for (const uid of recipe.categories) {
      countMap.set(uid, (countMap.get(uid) ?? 0) + 1);
    }
  }

  const sorted = categories.toSorted((a, b) => a.name.localeCompare(b.name));
  const knownUids = new Set(sorted.map((c) => c.uid));
  return sorted.map((c) => ({
    uid: c.uid,
    name: c.name,
    recipeCount: countMap.get(c.uid) ?? 0,
    // Match the text's orphan re-rooting (`formatCategoryList`): a parentUid that
    // points at a missing category is surfaced as null (top-level), so the model
    // rebuilding the tree from `parentUid` gets the same shape the human sees.
    parentUid: c.parentUid !== null && knownUids.has(c.parentUid) ? c.parentUid : null,
  }));
}

/**
 * `list_categories` — list categories with per-category recipe counts. Recipe owns
 * category, so both reads are within-domain (no deps).
 */
export const listCategoriesTool = defineTool(
  {
    name: "list_categories",
    title: "List recipe categories",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description: "List all recipe categories with the number of recipes in each. Categories are sorted alphabetically.",
    inputSchema: {},
    outputSchema: listCategoriesOutputSchema,
  },
  [categoryStartGuard],
  (ctx: DomainCtx<RecipeState, never>) => {
    return async (_args) => structuredResult({ items: buildCategoryRows(ctx.state) });
  },
);
