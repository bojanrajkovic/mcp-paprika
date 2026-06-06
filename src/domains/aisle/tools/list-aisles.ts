import type { DomainCtx } from "../../../kernel/registry.js";
import type { AisleState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { aisleStartGuard } from "./guards.js";

/**
 * `list_aisles` — list the aisle catalog. Aisle is a Reference-class entity:
 * read-only, no resource surface (ADR-0004).
 */
export const listAislesTool = defineTool(
  {
    name: "list_aisles",
    title: "List grocery aisles",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "List all known aisles, sorted by order then name. " +
      "Includes the aisle UID needed for pantry and grocery item writes.",
    inputSchema: {},
  },
  [aisleStartGuard],
  (ctx: DomainCtx<AisleState, never>) => {
    return async () => {
      const aisles = ctx.state.store.getAll().sort((a, b) => {
        if (a.orderFlag !== b.orderFlag) return a.orderFlag - b.orderFlag;
        return a.name.localeCompare(b.name);
      });
      if (aisles.length === 0) {
        return textResult(
          "No aisles found. Aisles are created in the Paprika app or automatically when you add a pantry item with a new aisle name.",
        );
      }
      const lines = aisles.map((a) => `- **${a.name}** — \`${a.uid}\``);
      return textResult(lines.join("\n"));
    };
  },
);
