import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { Recipe } from "../../../recipe/types.js";
import type { SemanticResult } from "../../vector-store.js";
import type { DiscoverSelf } from "../module.js";

import { recipeMetadataLines, textResult } from "../../../tools/helpers.js";

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

/**
 * Registers `discover_recipes`, kernel-shaped — semantic search over the vector
 * index this module owns (`ctx.self.vectorStore`), with recipe enrichment resolved
 * through the recipe contract (`ctx.deps.recipe.get` for the row, `resolveCategoryNames`
 * for its categories). Lifted verbatim from `src/tools/discover.ts`; the only
 * adaptations are reaching `self`/`deps` instead of the god-object `ServerContext`.
 *
 * FEATURE GATE (kernel-shaped — ADR-0009 §5#9): the legacy root registered this tool
 * only when `vectorStore !== null` (`src/server/build.ts:543`). The kernel registers
 * every module's tools unconditionally, so the gate moves INSIDE the wrapper: when
 * embeddings are unconfigured the `.self` factory carries a null `vectorStore`, and
 * the tool early-returns a clear "not configured" result instead of registering
 * conditionally. The tool is always present; it just declines to act.
 *
 * The legacy `coldStartGuard(ctx)` (recipe store synced) is DROPPED: the kernel
 * `RecipeApi` exposes no `hasSynced`, and the path degrades gracefully without it —
 * an empty index returns no hits, and `deps.recipe.get` returns `undefined` for a
 * not-yet-synced UID, which the enrichment filter already discards.
 */
export function discoverRecipesTool(ctx: DomainCtx<DiscoverSelf, "recipe">): void {
  const log = ctx.infra.log.child({ component: "discover_recipes" });
  ctx.server.registerTool(
    "discover_recipes",
    {
      title: "Discover recipes by natural-language search",
      annotations: { readOnlyHint: true, idempotentHint: true },
      description:
        "Discover recipes using semantic search. Finds recipes matching a natural language description of what you're looking for.",
      inputSchema: discoverRecipesInputSchema,
    },
    async (args): Promise<CallToolResult> => {
      log.info({ tool: "discover_recipes", ...args }, "tool invoked");

      // Feature gate: vectorStore is null when embeddings are unconfigured. The
      // legacy root skipped registration entirely; here the tool is registered but
      // declines, so the surface is uniform across deployments.
      const { vectorStore } = ctx.self;
      if (vectorStore === null) {
        return textResult(
          "Semantic search is not configured on this server, so `discover_recipes` is unavailable. " +
            "Use `search_recipes` for keyword, ingredient, and time filtering instead.",
        );
      }

      const results = await vectorStore.search(args.query, args.topK, args.minScore);
      if (results.length === 0) {
        return textResult("No recipes found matching that description.");
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
        return textResult("No recipes found matching that description.");
      }

      // Format results with re-numbered indices.
      const lines = enriched.map((entry, index) => {
        const categoryNames = ctx.deps.recipe.resolveCategoryNames(entry.recipe.categories);
        return formatDiscoverHit(index + 1, entry.recipe, entry.result.score, [...categoryNames]);
      });

      return textResult(lines.join("\n\n"));
    },
  );
}

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
