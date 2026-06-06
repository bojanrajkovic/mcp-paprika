import type { DomainCtx } from "../../../kernel/registry.js";
import type { Category } from "../category/types.js";
import type { RecipeState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { categoryStartGuard } from "./guards.js";

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
  },
  [categoryStartGuard],
  (ctx: DomainCtx<RecipeState, never>) => {
    return async (_args) => {
      const categories = ctx.state.category.store.getAll();
      if (categories.length === 0) {
        return textResult("No categories found in your recipe library.");
      }

      const recipes = ctx.state.recipe.store.getAll();

      // Initialize every category with count 0 so categories with no recipes
      // still appear in the output (AC4.3).
      const countMap = new Map<string, number>();
      for (const category of categories) {
        countMap.set(category.uid, 0);
      }

      // Increment count for each non-trashed recipe's categories.
      // getAll() already excludes trashed recipes.
      for (const recipe of recipes) {
        for (const uid of recipe.categories) {
          const current = countMap.get(uid) ?? 0;
          countMap.set(uid, current + 1);
        }
      }

      const sorted = categories.toSorted((a, b) => a.name.localeCompare(b.name));

      return textResult(formatCategoryList(sorted, countMap));
    };
  },
);

function formatCategoryList(categories: Array<Category>, countMap: Map<string, number>): string {
  // A category whose parentUid points at a UID not in the catalog is an
  // "orphan" — its parent was removed externally (another client / import).
  // The top-down walk below only reaches root-rooted subtrees, so an orphan
  // would silently vanish from a tool that promises to list ALL categories.
  // Re-root orphans (group them under `null`) so they always render, and flag
  // them with a ⚠️ disclosure so the broken parent link stays visible (#178).
  const existingUids = new Set<string>(categories.map((c) => c.uid));
  const isOrphan = (c: Category): boolean => c.parentUid !== null && !existingUids.has(c.parentUid);

  const byParent = new Map<string | null, Array<Category>>();
  for (const c of categories) {
    const key = isOrphan(c) ? null : (c.parentUid ?? null);
    const group = byParent.get(key);
    if (group) {
      group.push(c);
    } else {
      byParent.set(key, [c]);
    }
  }

  const lines: Array<string> = [];

  function walk(parentUid: string | null, depth: number): void {
    const children = byParent.get(parentUid);
    if (!children) return;
    const sorted = children.toSorted((a, b) => a.name.localeCompare(b.name));
    const indent = "  ".repeat(depth);
    for (const c of sorted) {
      const count = countMap.get(c.uid) ?? 0;
      const orphanNote = isOrphan(c) ? ` ⚠️ _(orphaned: parent \`${c.parentUid ?? ""}\` not found)_` : "";
      lines.push(
        `${indent}- **${c.name}** (${String(count)} ${count === 1 ? "recipe" : "recipes"}) — uid: \`${c.uid}\`${orphanNote}`,
      );
      walk(c.uid, depth + 1);
    }
  }

  walk(null, 0);
  return `## Recipe Categories\n\n${lines.join("\n")}`;
}
