import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";
import type { Recipe } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { errorResult, toolResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
import { recipePhotoResourceUri } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

// One parsed ingredient line: the canonical text plus its component section (a
// `## Spice Paste` header demoted to `group`, or null when the recipe is flat).
const cookIngredientSchema = z.object({
  text: z.string().min(1).describe("The ingredient line, verbatim from the recipe (quantity + item)."),
  group: z
    .string()
    .nullable()
    .describe(
      'The component/section this ingredient belongs to (e.g. "Spice Paste"), or null when the recipe has no sections.',
    ),
});

// One direction step with its ingredient anchoring — the model's parse, validated
// (never derived) server-side. `ingredientRefs` are the RAW ingredients added fresh;
// intermediates (a spice paste, a glaze) are first-class via produces/usesIntermediate.
const cookStepSchema = z.object({
  text: z.string().min(1).describe("The step's instruction text, verbatim."),
  group: z
    .string()
    .nullable()
    .describe("The component this step builds (matches an ingredient group), or null when the recipe is flat."),
  ingredientRefs: z
    .array(z.number().int().nonnegative())
    .describe(
      "Indices into `ingredients` for the RAW ingredients this step adds fresh — not items carried in via an " +
        'intermediate. Empty when the step adds nothing new (e.g. "bake 10 minutes").',
    ),
  produces: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "Name this step's output ONLY when it is set aside and consumed later by a non-adjacent or by multiple " +
        "steps (a spice paste, a baked crust, a marinade) — a later step then references it via `usesIntermediate`. " +
        "Null when the result flows straight into the next step. Names must be unique across steps.",
    ),
  usesIntermediate: z
    .array(z.string().min(1))
    .describe("Names of intermediates this step consumes — each must match a `produces` from an EARLIER step."),
});

export const cookRecipeInputSchema = z
  .object({
    recipe_uid: RecipeUidSchema.describe("UID of the recipe being cooked (from read_recipe / search_recipes)."),
    ingredients: z.array(cookIngredientSchema).min(1).describe("Every ingredient line, in the recipe's order."),
    steps: z
      .array(cookStepSchema)
      .min(1)
      .describe("Every direction step, in order, each anchored to the ingredients it uses."),
  })
  .strict();

export type CookRecipeInput = z.infer<typeof cookRecipeInputSchema>;

// The validated echo: the model's parse passed straight through, plus the stored
// recipe's identity (name/servings/totalTime/photo) so the model never retypes what
// the store already holds. The widget renders entirely off this structured channel.
export const cookRecipeOutputSchema = z.object({
  recipe_uid: RecipeUidSchema,
  name: z.string(),
  servings: z.string().nullable(),
  totalTime: z.string().nullable(),
  photoResourceUri: z.string().nullable(),
  ingredients: z.array(z.object({ text: z.string(), group: z.string().nullable() })),
  steps: z.array(
    z.object({
      text: z.string(),
      group: z.string().nullable(),
      ingredientRefs: z.array(z.number().int()),
      produces: z.string().nullable(),
      usesIntermediate: z.array(z.string()),
    }),
  ),
});

/**
 * The LLM-free internal-consistency check over the model's parse: the server
 * validates, it never derives. zod has already enforced the shapes (non-empty
 * text, ≥1 ingredient/step, non-negative refs); this adds the cross-references zod
 * can't see — refs in range, every intermediate produced by an EARLIER step, produces
 * names unique. Each failure returns a remediation hint, so a wrong parse is a
 * one-call fix rather than a silently broken widget. Returns null when valid.
 */
export function validateCookParse(args: CookRecipeInput): string | null {
  const n = args.ingredients.length;
  const produced = new Set<string>();
  for (let i = 0; i < args.steps.length; i++) {
    const step = args.steps[i]!;
    const stepNo = i + 1;
    for (const ref of step.ingredientRefs) {
      if (ref >= n) {
        return (
          `Step ${stepNo.toString()} references ingredient #${ref.toString()}, but there are only ` +
          `${n.toString()} ingredients (valid indices 0–${(n - 1).toString()}). ` +
          "Re-index ingredientRefs to match the ingredients array."
        );
      }
    }
    for (const name of step.usesIntermediate) {
      if (!produced.has(name)) {
        return (
          `Step ${stepNo.toString()} uses the intermediate "${name}", but no earlier step produces it. ` +
          `Add \`produces: "${name}"\` to the step that makes it, or correct the name to match an earlier \`produces\`.`
        );
      }
    }
    if (step.produces !== null) {
      if (produced.has(step.produces)) {
        return `Two steps both produce "${step.produces}" — intermediate names must be unique. Rename one.`;
      }
      produced.add(step.produces);
    }
  }
  return null;
}

/**
 * A readable cook-view for hosts without the widget surface (the text fallback beside
 * the structured channel): steps grouped by component, each step's raw ingredients and
 * the intermediates it uses/makes listed beneath. Numbered continuously across groups.
 */
export function cookToMarkdown(args: CookRecipeInput, recipe: Recipe): string {
  const lines: string[] = [`# Cook: ${recipe.name}`];
  const meta = [recipe.servings ? `${recipe.servings} servings` : null, recipe.totalTime].filter((v): v is string =>
    Boolean(v),
  );
  if (meta.length > 0) lines.push(meta.join(" · "));

  let lastGroup: string | null | undefined;
  let stepNo = 0;
  for (const step of args.steps) {
    if (step.group !== lastGroup) {
      lines.push("", `## ${step.group ?? "Steps"}`);
      lastGroup = step.group;
    }
    stepNo += 1;
    lines.push("", `${stepNo.toString()}. ${step.text}`);
    const adds = step.ingredientRefs.map((r) => args.ingredients[r]?.text).filter((t): t is string => Boolean(t));
    if (adds.length > 0) lines.push(`   - Add: ${adds.join(", ")}`);
    if (step.usesIntermediate.length > 0) lines.push(`   - Uses: ${step.usesIntermediate.join(", ")}`);
    if (step.produces !== null) lines.push(`   - Makes: ${step.produces}`);
  }
  return lines.join("\n");
}

/**
 * `cook_recipe` — open the interactive step-anchored cooking view. The structured
 * feed is authored by the MODEL, not derived from stored data — the first tool here
 * whose feed is model-authored: the assistant reads the recipe, parses it into the
 * anchored structure, and passes it here; the server validates internal consistency
 * and enriches the echo with the stored recipe's identity. Read-only — it writes nothing.
 */
export const cookRecipeTool = defineTool(
  {
    name: "cook_recipe",
    title: "Open the step-anchored cooking view",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Open the interactive step-anchored cooking view for a recipe. FIRST read the recipe with read_recipe — which " +
      "resolves a recipe by its title directly, so you do not need search_recipes first when the user names a recipe " +
      "to cook — THEN " +
      "parse its ingredients and directions into this structure and pass it here — the server validates and echoes " +
      "your parse, it does not parse for you. Anchor each direction step to the RAW ingredients it adds fresh " +
      "(ingredientRefs index into the ingredients array). Model multi-component recipes with intermediates: when a " +
      "step makes something set aside and used later (a spice paste, a glaze, a baked crust), give it a `produces` " +
      "name and reference it from the consuming step's `usesIntermediate` — by name, not by re-listing its raw " +
      "parts. Only name an intermediate that is genuinely set aside (used by a non-adjacent or by multiple later " +
      "steps); when a result flows straight into the next step, leave `produces` null. Keep ingredient lines and " +
      "step text verbatim; ingredient/direction section headers become the `group` on each line.",
    inputSchema: cookRecipeInputSchema,
    outputSchema: cookRecipeOutputSchema,
    // Hosts with the apps surface render this result as the step-anchored cooking
    // widget; others show the text/structured result unchanged.
    ui: { resourceUri: "ui://widget/cooking" },
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never>) => {
    return async (args) => {
      const recipe = ctx.state.recipe.store.get(args.recipe_uid);
      if (recipe === undefined) {
        return errorResult(
          `recipe_uid "${args.recipe_uid}" is not known to the local recipe store. ` +
            "Read the recipe first with read_recipe (or find its UID with search_recipes), then call cook_recipe with that UID.",
        );
      }
      const problem = validateCookParse(args);
      if (problem !== null) return errorResult(problem);

      return toolResult(cookToMarkdown(args, recipe), {
        recipe_uid: recipe.uid,
        name: recipe.name,
        servings: recipe.servings,
        totalTime: recipe.totalTime,
        photoResourceUri: recipePhotoResourceUri(recipe),
        ingredients: args.ingredients,
        steps: args.steps,
      });
    };
  },
);
