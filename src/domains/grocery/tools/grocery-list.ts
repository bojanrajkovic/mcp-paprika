import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryList } from "../grocery-list/types.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import {
  commitFailure,
  confirmOrCancel,
  errorResult,
  formatLookupOutcome,
  resolveLookup,
  toolResult,
  uidOrTextLookupSchema,
} from "../../../shared/tools.js";
import {
  groceryListReadOutputSchema,
  groceryListToMarkdown,
  groceryListToStructured,
  sortGroceryItemsForChecklist,
} from "../grocery-helpers.js";
import { GroceryListUidSchema } from "../ids.js";
import { groceryStartGuard } from "./guards.js";

// Structured-output payload (ADR-0019, R1): a row per grocery list, carrying the
// `uid` read_grocery_list / rename / delete consume plus its item count.
export const listGroceryListsOutputSchema = z.object({
  items: z.array(
    z.object({
      uid: GroceryListUidSchema,
      name: z.string(),
      itemCount: z.number().int().nonnegative(),
    }),
  ),
});

/**
 * `list_grocery_lists` — list all grocery lists with item counts. Counts come from
 * the co-owned item store, NOT a dep.
 */
export const listGroceryListsTool = defineTool(
  {
    name: "list_grocery_lists",
    title: "List your grocery lists",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description: "List all grocery lists sorted alphabetically by name, with UID and item count per list.",
    inputSchema: {},
    outputSchema: listGroceryListsOutputSchema,
  },
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    return async () => {
      const all = ctx.state.lists.store.getAll().sort((a, b) => a.name.localeCompare(b.name));
      const total = all.length;

      if (total === 0) {
        return toolResult("No grocery lists found.", { items: [] });
      }

      // Item count resolved once per list, feeding both the text and the structured row.
      const items = all.map((list) => ({
        uid: list.uid,
        name: list.name,
        itemCount: ctx.state.items.store.getByListUid(list.uid).length,
      }));
      const header = `You have ${total.toString()} grocery list(s):`;
      const lines = items.map((l) => `- **${l.name}** — ${l.itemCount.toString()} item(s) (uid: \`${l.uid}\`)`);

      return toolResult(header + "\n\n" + lines.join("\n"), { items });
    };
  },
);

/**
 * `read_grocery_list` — resolve a grocery list by UID/name and inline its items.
 */
export const readGroceryListTool = defineTool(
  {
    name: "read_grocery_list",
    title: "Read a grocery list and its items",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Get a grocery list by UID or name. Name lookup is tiered (exact → starts-with → contains) " +
      "and case-insensitive, with a disambiguation list when multiple lists match the same tier. " +
      "Each item's UID is returned so you can drive update_grocery_item / delete_grocery_item / " +
      "mark_grocery_item_purchased / move_grocery_items_to_pantry. " +
      'Pass exactly one shape: {"uid": "..."} or {"name": "..."}.',
    inputSchema: {
      lookup: uidOrTextLookupSchema({
        uidSchema: GroceryListUidSchema,
        textKey: "name",
        entityLabel: "grocery list",
        textExample: "Weekly Shopping",
      }),
    },
    outputSchema: groceryListReadOutputSchema,
    // Hosts with the apps surface render this result as the grocery checklist widget; others
    // show the text/structured result unchanged.
    ui: { resourceUri: "ui://widget/grocery-checklist" },
  },
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    return async (args) => {
      const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.name };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.state.lists.store.get(uid),
        findByText: (text) => ctx.state.lists.store.findByName(text),
      });
      // Emit items in store-walk order (aisle orderFlag → item orderFlag → uid) so the text table
      // and the structuredContent the checklist widget renders agree by construction. Memoized so the
      // sort + store scan run once even though formatLookupOutcome renders the same list twice (text
      // + structured).
      const checklistCache = new Map<string, ReturnType<typeof sortGroceryItemsForChecklist>>();
      const checklistItems = (list: GroceryList) => {
        const cached = checklistCache.get(list.uid);
        if (cached) return cached;
        const sorted = sortGroceryItemsForChecklist(ctx.state.items.store.getByListUid(list.uid), ctx.deps.aisle);
        checklistCache.set(list.uid, sorted);
        return sorted;
      };
      return formatLookupOutcome(ctx.server.server, outcome, {
        entityNoun: "grocery list",
        describe: (list) => ({ uid: list.uid, label: list.name }),
        findWith: "list_grocery_lists",
        renderOne: (list) => groceryListToMarkdown(list, checklistItems(list), ctx.deps.aisle),
        renderStructured: (list) => groceryListToStructured(list, checklistItems(list), ctx.deps.aisle),
      });
    };
  },
);

/**
 * `create_grocery_list` — create a new grocery list.
 */
export const createGroceryListTool = defineTool(
  {
    name: "create_grocery_list",
    title: "Create a grocery list",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    description:
      "Create a new grocery list with the given name. Rejects duplicate names (case-insensitive exact match); " +
      "if a duplicate is found, the response includes the existing UID.",
    inputSchema: {
      name: z.string().min(1).describe("Grocery list name (required)"),
    },
    outputSchema: groceryListReadOutputSchema,
  },
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "create_grocery_list" });
    return async (args) => {
      // Duplicate-name guard: only reject on exact case-insensitive match.
      // A starts-with or contains hit from findByName is NOT a duplicate.
      const matches = ctx.state.lists.store.findByName(args.name);
      const exactMatch = matches.find((l) => l.name.toLowerCase() === args.name.toLowerCase());
      if (exactMatch !== undefined) {
        return errorResult(
          `A grocery list named "${exactMatch.name}" already exists (UID: ${exactMatch.uid}). ` +
            `Use rename_grocery_list to change its name.`,
        );
      }

      const uid = GroceryListUidSchema.parse(crypto.randomUUID().toUpperCase());
      const newList: GroceryList = {
        uid,
        name: args.name,
        isDefault: false,
        orderFlag: 0,
        remindersList: "Paprika",
        deleted: false,
      };

      return (await ctx.infra.client.saveGroceryList(newList)).match(
        async (saved) => {
          const structured = groceryListToStructured(saved, [], ctx.deps.aisle);
          const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryList(saved), {
            structuredContent: structured,
          });
          if (commitErr) return commitErr;
          return toolResult(groceryListToMarkdown(saved, [], ctx.deps.aisle), structured);
        },
        async (e) => {
          log.error({ err: e, name: args.name }, "saveGroceryList failed");
          return errorResult(`Failed to create grocery list: ${e.message}`);
        },
      );
    };
  },
);

/**
 * `rename_grocery_list` — rename a grocery list.
 */
export const renameGroceryListTool = defineTool(
  {
    name: "rename_grocery_list",
    title: "Rename a grocery list",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Rename a grocery list. Rejects if the new name conflicts with a different existing list.",
    inputSchema: {
      uid: GroceryListUidSchema.describe("Grocery list UID to rename"),
      newName: z.string().min(1).describe("New name for the grocery list"),
    },
    outputSchema: groceryListReadOutputSchema,
  },
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "rename_grocery_list" });
    return async (args) => {
      const existing = ctx.state.lists.store.get(args.uid);

      if (!existing) {
        return errorResult(
          `No grocery list found with UID "${args.uid}" (it may not exist or was already deleted). Use \`list_grocery_lists\` to find it.`,
        );
      }

      // Same-name no-op: case-insensitive check. Return the existing list rendered as markdown.
      if (existing.name.toLowerCase() === args.newName.toLowerCase()) {
        const items = ctx.state.items.store.getByListUid(existing.uid);
        return toolResult(
          groceryListToMarkdown(existing, items, ctx.deps.aisle),
          groceryListToStructured(existing, items, ctx.deps.aisle),
        );
      }

      // Conflict check: reject if another list (different UID) has the exact same name.
      const conflictMatches = ctx.state.lists.store.findByName(args.newName);
      const conflict = conflictMatches.find(
        (l) => l.name.toLowerCase() === args.newName.toLowerCase() && l.uid !== args.uid,
      );
      if (conflict !== undefined) {
        return errorResult(
          `A grocery list named "${conflict.name}" already exists (UID: ${conflict.uid}). Choose a different name.`,
        );
      }

      const renamed: GroceryList = { ...existing, name: args.newName };

      return (await ctx.infra.client.saveGroceryList(renamed)).match(
        async (saved) => {
          const items = ctx.state.items.store.getByListUid(saved.uid);
          const structured = groceryListToStructured(saved, items, ctx.deps.aisle);
          const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryList(saved), {
            structuredContent: structured,
          });
          if (commitErr) return commitErr;
          return toolResult(groceryListToMarkdown(saved, items, ctx.deps.aisle), structured);
        },
        async (e) => {
          log.error({ err: e, uid: args.uid, newName: args.newName }, "saveGroceryList failed");
          return errorResult(`Failed to rename grocery list: ${e.message}`);
        },
      );
    };
  },
);

/**
 * `delete_grocery_list` — remove a grocery list (soft-delete tombstone).
 */
export const deleteGroceryListTool = defineTool(
  {
    name: "delete_grocery_list",
    title: "Delete a grocery list",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description: "Delete a grocery list by UID.",
    inputSchema: {
      uid: GroceryListUidSchema.describe("Grocery list UID to delete"),
    },
  },
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "delete_grocery_list" });
    return async (args) => {
      const existing = ctx.state.lists.store.get(args.uid);

      if (!existing) {
        return toolResult(`No grocery list found with UID "${args.uid}" (it may not exist or was already deleted).`);
      }

      const itemCount = ctx.state.items.store.getByListUid(args.uid).length;
      const stop = await confirmOrCancel(ctx.server.server, {
        message: `Permanently delete grocery list "${existing.name}" and its ${itemCount.toString()} item(s)? This cannot be undone.`,
        cancelled: `Cancelled — "${existing.name}" was not deleted.`,
        log,
      });
      if (stop) return stop;

      const trashed: GroceryList = { ...existing, deleted: true };

      return (await ctx.infra.client.saveGroceryList(trashed)).match(
        async (saved) => {
          const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryList(saved));
          if (commitErr) return commitErr;
          return toolResult(`Grocery list "${existing.name}" has been deleted.`);
        },
        async (e) => {
          log.error({ err: e, uid: args.uid }, "saveGroceryList failed");
          return toolResult(`Failed to delete grocery list: ${e.message}`);
        },
      );
    };
  },
);
