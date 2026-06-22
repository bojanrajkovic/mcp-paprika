import { describe, expect, it } from "vitest";
import { z } from "zod";

import { collectToolSpecs } from "../../scripts/tool-specs.js";
import { RecipeUidSchema } from "../../src/domains/recipe/ids.js";
import { toolResult } from "../../src/shared/tools.js";

/**
 * ADR-0019 structured-output conformance — the channel is *expressible* (the
 * two-argument `toolResult` envelope parses against a declared `outputSchema`) and
 * the rollout is *underway* (A3 #318 made the meal reads its first adopters).
 *
 * The positive check parses the envelope against the schema DIRECTLY:
 * `makeTestServer` discards the `registerTool` config and never runs the SDK's
 * `validateToolOutput`, so a harness round-trip would assert nothing. That a
 * declared schema reaches the real `tools/list` advertisement (the `toJsonSchema`
 * path), and the SDK's success/`isError` validation contract, are anchored
 * separately in `src/kernel/tool.e2e.test.ts`.
 *
 * The adoption invariant is the tree-wide gate: it pins the EXACT set of
 * schema-bearing tools. It started empty (A1 was inert); A3 #318 added the three
 * meal reads. Each later A3/A2/B1 batch ADDS its tool names here — an explicit
 * allowlist, so a tool that gains a schema unexpectedly (or one that should have
 * but didn't) trips the gate rather than sliding by.
 */

describe("ADR-0019: structured-output envelope and rollout", () => {
  it("a structured toolResult parses against the tool's own outputSchema", () => {
    // A representative list-read payload: rows wrapped under a record key (the
    // SDK's structuredContent is a record, never a bare top-level array), each
    // carrying a branded UID (a compile-time brand, plain string at runtime —
    // ADR-0007) plus the human-facing field.
    const outputSchema = z.object({
      items: z.array(z.object({ uid: RecipeUidSchema, name: z.string() })),
    });
    const payload = {
      items: [
        { uid: "r1", name: "Pasta" },
        { uid: "r2", name: "Soup" },
      ],
    };

    const result = toolResult("Pasta\nSoup", payload);

    // The text block is always present and unchanged by the structured channel.
    expect(result.content).toEqual([{ type: "text", text: "Pasta\nSoup" }]);
    // The structured payload satisfies the declared schema the SDK would validate.
    expect(outputSchema.safeParse(result.structuredContent).success).toBe(true);
  });

  it("exactly the rolled-out R1 tools declare an outputSchema (the conformance frontier)", async () => {
    const withSchema = (await collectToolSpecs())
      .filter((s) => s.outputSchema !== undefined)
      .map((s) => s.name)
      .sort();
    // A3 #318 — the meal reads (first adopters). A3 #319 — the recipe/grocery/menu list
    // tools. A3 #320 — the catalogs, pantry list, and discover. B1 #321 — the uid-or-text
    // reads (read_recipe/read_grocery_list/read_menu/read_pantry_item) + the create/echo
    // tools that surface a new UID. R1 #367 — the last two unsafe creators
    // (add_pantry_items / add_recipe_to_grocery_list), which surfaced new UIDs only in
    // text. R1 #399 — the meal creators/mover that mint new entity UIDs (log_cooked_meal,
    // move_grocery_items_to_pantry, plan_meals, schedule_menu). R1 — the recipe write-acks
    // that echo a resolvable recipe (categorize_recipe, favorite_recipe/unfavorite_recipe,
    // pin_recipe/unpin_recipe, rate_recipe, restore_recipe, trash_recipe, update_recipe).
    // R1 — the grocery/pantry/meal write-acks that echo a resolvable entity
    // (mark_grocery_item_purchased, mark_pantry_item_out_of_stock, reschedule_meal,
    // restock_pantry_item, update_grocery_item, update_meal, update_pantry_item).
    // R1 — the menu and catalog write-acks that echo their whole container
    // (move_menu_item, update_menu, update_menu_item echo the parent menu; update_aisle,
    // update_category, update_meal_type echo the full reordered catalog list).
    // Add each later batch's tool names as they land.
    expect(withSchema).toEqual([
      "add_grocery_items",
      "add_menu_items",
      "add_pantry_items",
      "add_recipe_to_grocery_list",
      "categorize_recipe",
      "create_category",
      "create_grocery_list",
      "create_menu",
      "create_recipe",
      "discover_recipes",
      "favorite_recipe",
      "list_aisles",
      "list_categories",
      "list_grocery_lists",
      "list_meal_types",
      "list_menus",
      "list_pantry_items",
      "list_recipes",
      "log_cooked_meal",
      "mark_grocery_item_purchased",
      "mark_pantry_item_out_of_stock",
      "move_grocery_items_to_pantry",
      "move_menu_item",
      "pin_recipe",
      "plan_meals",
      "rate_recipe",
      "read_grocery_list",
      "read_meal_plan",
      "read_menu",
      "read_pantry_item",
      "read_recipe",
      "read_recipe_history",
      "rename_grocery_list",
      "reschedule_meal",
      "restock_pantry_item",
      "restore_recipe",
      "schedule_menu",
      "search_meal_history",
      "search_recipes",
      "trash_recipe",
      "unfavorite_recipe",
      "unpin_recipe",
      "update_aisle",
      "update_category",
      "update_grocery_item",
      "update_meal",
      "update_meal_type",
      "update_menu",
      "update_menu_item",
      "update_pantry_item",
      "update_recipe",
    ]);
  });
});
