import { z } from "zod";

import type { Recipe } from "../../../domains/recipe/types.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { SemanticResult } from "../../vector-store.js";
import type { DiscoverState } from "../module.js";

import { browseContextSchema, recipeMetadataLines, recipeRowSchema } from "../../../domains/recipe/recipe-markdown.js";
import { defineTool } from "../../../kernel/tool.js";
import { errorResult, toolResult } from "../../../shared/tools.js";

export const discoverRecipesInputSchema = {
  query: z.string().describe("Natural language description of what you're looking for"),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Maximum number of results to return (default: 5, max: 20)"),
  minScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Optional minimum similarity (cosine, 0-1). Results below it are dropped before the top-K cut, so a query with few genuine matches returns only those instead of padding with weak ones. Omit for no filtering. Use a modest value (e.g. ~0.3) to gate on relevance.",
    ),
};

// Structured-output payload (ADR-0019, R1): each hit is a recipe row (shared with
// list_recipes / search_recipes) plus its similarity `score`. A query that matches
// nothing is a valid empty success; "not configured" / not-yet-synced / search
// failure are errorResults (the tool can't fulfil the request).
const discoverRowSchema = recipeRowSchema.extend({ score: z.number().describe("Cosine similarity, 0–1.") });
// `context` carries the source + query for the recipe-browse widget's "Recipes for you"
// header; the widget never re-sorts discover results — the semantic ranking is the value.
export const discoverRecipesOutputSchema = z.object({
  context: browseContextSchema,
  items: z.array(discoverRowSchema),
});

/**
 * `discover_recipes` — semantic search over the vector index this module owns
 * (`ctx.state.vectorStore`), with recipe enrichment resolved through the recipe
 * contract (`ctx.deps.recipe.get` for the row, `resolveCategoryNames` for its
 * categories).
 *
 * FEATURE GATE: the kernel registers every module's tools
 * unconditionally. When embeddings are unconfigured the `.state` factory carries a null
 * `vectorStore`, and the tool early-returns a clear "not configured" result. The tool
 * is always present; it just declines to act.
 *
 * `ctx.deps.recipe.hasSynced()` guards against a warm-from-disk index returning hits
 * whose UIDs the not-yet-synced recipe store still lacks — the enrichment filter would
 * drop them and report a misleading "no matches" rather than the retry hint.
 */
export const discoverRecipesTool = defineTool(
  {
    name: "discover_recipes",
    title: "Discover recipes by natural-language search",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Discover recipes using semantic search. Finds recipes matching a natural language description of what you're looking for.",
    inputSchema: discoverRecipesInputSchema,
    outputSchema: discoverRecipesOutputSchema,
    // Hosts with the apps surface render this result as the recipe-browser widget; others
    // show the text/structured result unchanged.
    ui: { resourceUri: "ui://widget/recipe-browser" },
  },
  (ctx: DomainCtx<DiscoverState, "recipe">) => {
    const log = ctx.infra.log.child({ component: "discover_recipes" });
    return async (args) => {
      // Feature gate: vectorStore is null when embeddings are unconfigured. The tool
      // is registered unconditionally and declines here, so the surface is uniform
      // across deployments.
      const { vectorStore } = ctx.state;
      if (vectorStore === null) {
        // Capability gap on this deployment — the tool can't act, so isError (exempt
        // from the schema's output validation) with the redirect hint.
        return errorResult(
          "Semantic search is not configured on this server, so `discover_recipes` is unavailable. " +
            "Use `search_recipes` for keyword, ingredient, and time filtering instead.",
        );
      }

      // Cold-start guard: a warm-from-disk index can return hits whose UIDs the
      // not-yet-synced recipe store lacks, which the enrichment filter would drop and
      // report as "no matches" — return the retry hint instead.
      if (!ctx.deps.recipe.hasSynced()) {
        return errorResult("Recipe store is not yet synced. Try again in a few seconds.");
      }

      // The recipe-browse widget's source envelope — discover always has a query.
      const browseContext = { source: "discover" as const, query: args.query };

      const results = (await vectorStore.search(args.query, args.topK, args.minScore)).match(
        (v) => v,
        (e) => {
          log.error({ err: e }, "semantic search failed");
          return errorResult(`Semantic search failed: ${e.message}. Use search_recipes for keyword search instead.`);
        },
      );
      if ("content" in results) return results;
      if (results.length === 0) {
        // No semantic match is a valid empty success.
        return toolResult("No recipes found matching that description.", { context: browseContext, items: [] });
      }

      // Enrich results and filter out recipes that are gone or trashed.
      // `deps.recipe.get` returns trashed recipes (unlike a live-only listing), and
      // a stale vector can outlive a soft-delete, so guard on `inTrash` here as
      // defense-in-depth even though the recipe commit path removes trashed recipes
      // from the index.
      const enriched: Array<{ result: SemanticResult; recipe: Recipe }> = [];
      for (const result of results) {
        const recipe = ctx.deps.recipe.get(result.uid);
        if (recipe && !recipe.inTrash) {
          enriched.push({ result, recipe });
        }
      }

      if (enriched.length === 0) {
        return toolResult("No recipes found matching that description.", { context: browseContext, items: [] });
      }

      // Build the structured rows through the recipe contract (it resolves each row's
      // category names against recipe's own store) once, then layer the similarity score
      // on each. The text line reuses the row's already-resolved `categories`, so the
      // structured and text categories can't drift and each hit resolves names once.
      const rows = ctx.deps.recipe.toRows(enriched.map((entry) => entry.recipe));
      const items: Array<z.infer<typeof discoverRowSchema>> = [];
      const lines: Array<string> = [];
      enriched.forEach((entry, index) => {
        const row = rows[index]!;
        items.push({ ...row, score: entry.result.score });
        lines.push(formatDiscoverHit(index + 1, entry.recipe, entry.result.score, row.categories));
      });

      return toolResult(lines.join("\n\n"), { context: browseContext, items });
    };
  },
);

function formatDiscoverHit(index: number, recipe: Recipe, score: number, categoryNames: Array<string>): string {
  const percentage = Math.round(score * 100);
  const lines: Array<string> = [];
  lines.push(`${String(index)}. **${recipe.name}** — ${String(percentage)}% match`);
  lines.push(`   UID: \`${recipe.uid}\``);
  if (categoryNames.length > 0) {
    lines.push(`   **Categories:** ${categoryNames.join(", ")}`);
  }
  for (const line of recipeMetadataLines(recipe)) {
    lines.push(`   ${line}`);
  }
  return lines.join("\n");
}
