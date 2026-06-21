import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { formatLookupOutcome, resolveLookup, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { PantryItemUidSchema } from "../ids.js";
import { pantryItemReadOutputSchema, pantryItemToMarkdown, pantryItemToStructured } from "../pantry-helpers.js";
import { pantryStartGuard } from "./guards.js";

/**
 * `read_pantry_item` — read one pantry item by UID or fuzzy name match, via the
 * shared lookup/format helpers and `pantryItemToMarkdown`.
 */
export const getPantryItemTool = defineTool(
  {
    name: "read_pantry_item",
    title: "Read a pantry item",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Get a pantry item by UID or ingredient name. Ingredient lookup is fuzzy " +
      "(exact → starts-with → contains) and case-insensitive, with a disambiguation list " +
      "when multiple items match the same tier. " +
      'Pass exactly one shape: {"uid": "..."} or {"ingredient": "..."}.',
    inputSchema: {
      lookup: uidOrTextLookupSchema({
        uidSchema: PantryItemUidSchema,
        textKey: "ingredient",
        entityLabel: "pantry item",
        // Override the template — "Pantry item ingredient fuzzy match" reads
        // awkwardly; the natural phrasing matches the pre-#142 describe text.
        textDescribe: 'Ingredient name fuzzy match, e.g. {"ingredient": "Olive Oil"}.',
      }),
    },
    outputSchema: pantryItemReadOutputSchema,
  },
  [pantryStartGuard],
  (ctx: DomainCtx<PantryState, "aisle">) => {
    return async (args) => {
      const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.ingredient };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.state.store.get(uid),
        findByText: (text) => ctx.state.store.findByIngredient(text),
      });
      return formatLookupOutcome(ctx.server.server, outcome, {
        entityNoun: "pantry item",
        describe: (item) => ({ uid: item.uid, label: item.ingredient }),
        findWith: "list_pantry_items",
        renderOne: (item) => pantryItemToMarkdown(item, ctx.deps.aisle),
        renderStructured: (item) => pantryItemToStructured(item, ctx.deps.aisle),
        log: ctx.infra.log,
      });
    };
  },
);
