import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { errorResult, structuredResult } from "../../../shared/tools.js";
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
  phase: z
    .enum(["prep", "cook"])
    .describe(
      'Which side of the first application of heat this step is on. "prep" = mise-en-place done before cooking ' +
        "starts (knife work the ingredient line doesn't already state, making a sub-component, a marinade or soak, " +
        "oven/grill/equipment setup); the cooking view collects the prep-phase steps onto a prep screen ahead of " +
        'the stepper. "cook" = a step performed once cooking is underway. When an ingredient line already states ' +
        'its cut ("1 onion, diced"), you usually do NOT need a separate prep step — the gather chip carries it; ' +
        "reserve prep steps for the work the ingredient list cannot express.",
    ),
});

// The model's split of the prep budget, surfaced on the prep screen as a real,
// schedulable step. `activeMin` is hands-on mise-en-place; `passiveWaitMin` is the
// unattended wait (marinate/soak/chill/rest) that, when long, must be started first.
const cookPrepSchema = z.object({
  activeMin: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Your estimate of hands-on prep minutes before first heat — knife work, measuring, making sub-components. " +
        "Active work only; do NOT fold marinating/resting time in here.",
    ),
  passiveWaitMin: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Unattended wait BEFORE first heat that the cook must start ahead of cooking — marinating, soaking, brining, " +
        "chilling a dough. 0 when there is none. It is surfaced on the prep screen as 'start this first', so do NOT " +
        "include post-cook rests (resting meat, cooling): those happen after cooking and stay as cook steps.",
    ),
});

export const cookRecipeInputSchema = z
  .object({
    recipe_uid: RecipeUidSchema.describe("UID of the recipe being cooked (from read_recipe / search_recipes)."),
    ingredients: z.array(cookIngredientSchema).min(1).describe("Every ingredient line, in the recipe's order."),
    steps: z
      .array(cookStepSchema)
      .min(1)
      .describe("Every direction step, in order, each anchored to the ingredients it uses."),
    prep: cookPrepSchema.describe(
      "Your prep-time estimate, split into hands-on (activeMin) and unattended wait (passiveWaitMin).",
    ),
  })
  .strict();

export type CookRecipeInput = z.infer<typeof cookRecipeInputSchema>;

// The validated echo: the model's parse passed straight through, plus the stored
// recipe's identity (name/servings/totalTime/prepTime/photo) so the model never retypes
// what the store already holds. The widget renders entirely off this structured channel.
// `prepTime` is the recipe's STATED prep (enriched from the store) — shown as a secondary
// to the model's own `prep` estimate, which the stated value routinely under- or over-reports.
export const cookRecipeOutputSchema = z.object({
  recipe_uid: RecipeUidSchema,
  name: z.string(),
  servings: z.string().nullable(),
  totalTime: z.string().nullable(),
  prepTime: z.string().nullable(),
  photoResourceUri: z.string().nullable(),
  ingredients: z.array(z.object({ text: z.string(), group: z.string().nullable() })),
  prep: cookPrepSchema,
  steps: z.array(
    z.object({
      text: z.string(),
      group: z.string().nullable(),
      ingredientRefs: z.array(z.number().int()),
      produces: z.string().nullable(),
      usesIntermediate: z.array(z.string()),
      phase: z.enum(["prep", "cook"]),
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
  let cookStarted = false;
  for (let i = 0; i < args.steps.length; i++) {
    const step = args.steps[i]!;
    const stepNo = i + 1;
    // Prep is the mise-en-place done BEFORE first heat, so the widget collects every
    // prep-phase step onto a pre-stepper prep screen. A `prep` step tagged AFTER a `cook`
    // step would be hoisted ahead of the cook sequence — reordering the recipe — so reject
    // it: the model must re-tag a mid-cook action as `cook`.
    if (step.phase === "cook") {
      cookStarted = true;
    } else if (cookStarted) {
      return (
        `Step ${stepNo.toString()} is tagged "prep", but an earlier step is already "cook". ` +
        "Prep is the mise-en-place done before cooking starts, so every prep step must come before the " +
        'first cook step. Re-tag this step as "cook" (it happens once cooking is underway), or reorder the steps.'
      );
    }
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
      "Open the interactive step-anchored cooking view for a recipe. FIRST read the recipe (read_recipe), THEN " +
      "parse its ingredients and directions into this structure and pass it here — the server validates and echoes " +
      "your parse, it does not parse for you. Anchor each direction step to the RAW ingredients it adds fresh " +
      "(ingredientRefs index into the ingredients array). Model multi-component recipes with intermediates: when a " +
      "step makes something set aside and used later (a spice paste, a glaze, a baked crust), give it a `produces` " +
      "name and reference it from the consuming step's `usesIntermediate` — by name, not by re-listing its raw " +
      "parts. Only name an intermediate that is genuinely set aside (used by a non-adjacent or by multiple later " +
      "steps); when a result flows straight into the next step, leave `produces` null. Keep ingredient lines and " +
      "step text verbatim; ingredient/direction section headers become the `group` on each line. Tag each step's " +
      "`phase` — `prep` for mise-en-place done before first heat, `cook` once cooking is underway — and give a " +
      "`prep` time estimate split into hands-on `activeMin` and unattended `passiveWaitMin` (marinate/soak/rest); " +
      "the view leads with a prep screen built from the prep-phase steps over the ingredient gather list.",
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

      return structuredResult({
        recipe_uid: recipe.uid,
        name: recipe.name,
        servings: recipe.servings,
        totalTime: recipe.totalTime,
        prepTime: recipe.prepTime,
        photoResourceUri: recipePhotoResourceUri(recipe),
        ingredients: args.ingredients,
        prep: args.prep,
        steps: args.steps,
      });
    };
  },
);
