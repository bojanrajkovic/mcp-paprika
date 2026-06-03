import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ServerContext } from "../types/server-context.js";

import { PantryItemUidSchema } from "../ids.js";
import { formatLookupOutcome, resolveLookup, uidOrTextLookupSchema } from "./helpers.js";
import { pantryItemToMarkdown, pantryStartGuard } from "./pantry-helpers.js";

export function registerGetPantryItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "read_pantry_item" });
  server.registerTool(
    "read_pantry_item",
    {
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
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.ingredient };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.pantryStore.get(uid),
            findByText: (text) => ctx.pantryStore.findByIngredient(text),
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
