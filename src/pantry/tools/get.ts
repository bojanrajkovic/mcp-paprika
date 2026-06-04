import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../kernel/registry.js";
import type { PantrySelf } from "../module.js";

import { PantryItemUidSchema } from "../../ids.js";
import { formatLookupOutcome, resolveLookup, uidOrTextLookupSchema } from "../../tools/helpers.js";
import { pantryItemToMarkdown } from "../../tools/pantry-helpers.js";
import { pantryStartGuard } from "./guards.js";

/**
 * Registers `read_pantry_item`, kernel-shaped — reads this module's own store via
 * `ctx.self`. The shared lookup/format helpers and `pantryItemToMarkdown` are pure
 * renderers reused in place from `src/tools/`.
 */
export function getPantryItemTool(ctx: DomainCtx<PantrySelf, "aisle">): void {
  const log = ctx.infra.log.child({ component: "read_pantry_item" });
  ctx.server.registerTool(
    "read_pantry_item",
    {
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
    },
    async (args) => {
      log.info({ tool: "read_pantry_item", ...args.lookup }, "tool invoked");
      return pantryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.ingredient };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.self.store.get(uid),
            findByText: (text) => ctx.self.store.findByIngredient(text),
          });
          return formatLookupOutcome(outcome, {
            entityNoun: "pantry item",
            renderOne: (item) => pantryItemToMarkdown(item),
            disambiguationLine: (item) => `- **${item.ingredient}** (uid: \`${item.uid}\`)`,
          });
        },
        (guard) => guard,
      );
    },
  );
}
