import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealTypeState } from "../module.js";
import type { MealType } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { mealTypeStartGuard } from "./guards.js";

/**
 * Format seconds-since-midnight as zero-padded `HH:MM` (e.g. 64800 → "18:00").
 * Meal types store their calendar-export time this way (`exportTime`). There is
 * no shared seconds→clock helper in the repo and this is the only caller, so it
 * stays local rather than landing in `utils/dates.ts`.
 */
function formatSeconds(seconds: number): string {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Render one meal type as a markdown bullet, e.g.
 *   `- **Dinner** (built-in, 18:00) — \`<uid>\``
 * `originalType` is the built-in/custom marker (an integer for the four defaults,
 * `null` for user-created types). The schedule is "all-day" when `exportAllDay`,
 * otherwise the export clock time. The UID is included so callers can reference a
 * type by stable id via `plan_meals` / `update_meal`'s `type: { uid }` spec.
 */
function mealTypeLine(mt: Readonly<MealType>): string {
  const kind = mt.originalType !== null ? "built-in" : "custom";
  const schedule = mt.exportAllDay ? "all-day" : formatSeconds(mt.exportTime);
  return `- **${mt.name}** (${kind}, ${schedule}) — \`${mt.uid}\``;
}

/**
 * `list_meal_types` — list the meal-type catalog (sorted by order then name, one
 * bullet per entry, no input). Meal-type is a Reference-class entity: read-only, no
 * resource (ADR-0004). Mirrors `list_aisles`. Meal types are created/edited in the
 * Paprika app, not via MCP.
 */
export const listMealTypesTool = defineTool(
  {
    name: "list_meal_types",
    title: "List meal types",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "List all meal types — the built-in Breakfast/Lunch/Dinner/Snacks plus any custom " +
      "types — sorted by order then name. Each entry shows whether it is built-in or custom, " +
      "its calendar-export schedule (all-day or a clock time), and its UID. Reference a type " +
      "by name, or pass its UID to plan_meals / update_meal via the `type: { uid }` spec. " +
      "Meal types are created and edited in the Paprika app, not through this server.",
    inputSchema: {},
  },
  [mealTypeStartGuard],
  (ctx: DomainCtx<MealTypeState, never>) => {
    return async () => {
      const mealTypes = ctx.state.store.getAll().sort((a, b) => {
        if (a.orderFlag !== b.orderFlag) return a.orderFlag - b.orderFlag;
        return a.name.localeCompare(b.name);
      });

      if (mealTypes.length === 0) {
        return textResult("No meal types found.");
      }

      const lines = mealTypes.map(mealTypeLine);
      return textResult(lines.join("\n"));
    };
  },
);
