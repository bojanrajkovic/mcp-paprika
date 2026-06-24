import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { AisleState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { sortCatalog } from "../../../shared/catalog.js";
import { structuredResult } from "../../../shared/tools.js";
import { AisleUidSchema } from "../ids.js";
import { aisleStartGuard } from "./guards.js";

// Structured-output payload (ADR-0019, R1): one row per aisle — the `uid` pantry and
// grocery item writes consume, plus the name.
export const listAislesOutputSchema = z.object({
  items: z.array(z.object({ uid: AisleUidSchema, name: z.string() })),
});

/**
 * Build the {@link listAislesOutputSchema} rows from the aisle catalog — sorted by
 * order then name, one `{uid, name}` per aisle. Shared by `list_aisles` and
 * `update_aisle` so the two echo the identical full-catalog shape.
 */
export function buildAisleRows(state: AisleState): z.infer<typeof listAislesOutputSchema>["items"] {
  return sortCatalog(state.store.getAll()).map((a) => ({ uid: a.uid, name: a.name }));
}

/**
 * `list_aisles` — list the aisle catalog. Aisle is a Reference-class entity:
 * list tool + managed lifecycle (auto-create via `ensureAisle`, `update_aisle`,
 * `delete_aisle`), no resource surface.
 */
export const listAislesTool = defineTool(
  {
    name: "list_aisles",
    title: "List grocery aisles",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "List all known aisles, sorted by order then name. " +
      "Includes the aisle UID needed for pantry and grocery item writes. " +
      "There is no create-aisle tool: a new aisle is created automatically when you add a grocery or " +
      "pantry item naming an aisle that does not exist yet.",
    inputSchema: {},
    outputSchema: listAislesOutputSchema,
  },
  [aisleStartGuard],
  (ctx: DomainCtx<AisleState, never>) => {
    return async () => structuredResult({ items: buildAisleRows(ctx.state) });
  },
);
