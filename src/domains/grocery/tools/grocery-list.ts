import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryList } from "../grocery-list/types.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { GroceryListUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { formatLookupOutcome, resolveLookup, textResult, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { groceryListToMarkdown } from "../grocery-helpers.js";
import { groceryStartGuard } from "./guards.js";

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
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    const log = ctx.infra.log.child({ component: "list_grocery_lists" });
    return async () => {
      log.info({ tool: "list_grocery_lists" }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const all = ctx.state.lists.store.getAll().sort((a, b) => a.name.localeCompare(b.name));
          const total = all.length;

          if (total === 0) {
            return textResult("No grocery lists found.");
          }

          const header = `You have ${total.toString()} grocery list(s):`;
          const lines = all.map((list) => {
            const itemCount = ctx.state.items.store.getByListUid(list.uid).length;
            return `- **${list.name}** — ${itemCount.toString()} item(s) (uid: \`${list.uid}\`)`;
          });

          return textResult(header + "\n\n" + lines.join("\n"));
        },
        (guard) => guard,
      );
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
      'Pass exactly one shape: {"uid": "..."} or {"name": "..."}.',
    inputSchema: {
      lookup: uidOrTextLookupSchema({
        uidSchema: GroceryListUidSchema,
        textKey: "name",
        entityLabel: "grocery list",
        textExample: "Weekly Shopping",
      }),
    },
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    const log = ctx.infra.log.child({ component: "read_grocery_list" });
    return async (args) => {
      log.info({ tool: "read_grocery_list", ...args.lookup }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.name };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.state.lists.store.get(uid),
            findByText: (text) => ctx.state.lists.store.findByName(text),
          });
          return formatLookupOutcome(outcome, {
            entityNoun: "grocery list",
            renderOne: (list) => groceryListToMarkdown(list, ctx.state.items.store.getByListUid(list.uid)),
            disambiguationLine: (list) => `- **${list.name}** (uid: \`${list.uid}\`)`,
          });
        },
        (guard) => guard,
      );
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
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "create_grocery_list" });
    return async (args) => {
      log.info({ tool: "create_grocery_list", name: args.name }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          // Duplicate-name guard: only reject on exact case-insensitive match.
          // A starts-with or contains hit from findByName is NOT a duplicate.
          const matches = ctx.state.lists.store.findByName(args.name);
          const exactMatch = matches.find((l) => l.name.toLowerCase() === args.name.toLowerCase());
          if (exactMatch !== undefined) {
            return textResult(
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

          try {
            const saved = await ctx.infra.client.saveGroceryList(newList);
            await ctx.writes.commitGroceryList(saved);
            return textResult(groceryListToMarkdown(saved, []));
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, name: args.name }, "saveGroceryList failed");
            return textResult(`Failed to create grocery list: ${message}`);
          }
        },
        (guard) => guard,
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
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "rename_grocery_list" });
    return async (args) => {
      log.info({ tool: "rename_grocery_list", uid: args.uid, newName: args.newName }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.lists.store.get(args.uid);

          if (!existing) {
            return textResult(
              `No grocery list found with UID "${args.uid}" (it may not exist or was already deleted).`,
            );
          }

          // Same-name no-op: case-insensitive check. Return the existing list rendered as markdown.
          if (existing.name.toLowerCase() === args.newName.toLowerCase()) {
            const items = ctx.state.items.store.getByListUid(existing.uid);
            return textResult(groceryListToMarkdown(existing, items));
          }

          // Conflict check: reject if another list (different UID) has the exact same name.
          const conflictMatches = ctx.state.lists.store.findByName(args.newName);
          const conflict = conflictMatches.find(
            (l) => l.name.toLowerCase() === args.newName.toLowerCase() && l.uid !== args.uid,
          );
          if (conflict !== undefined) {
            return textResult(
              `A grocery list named "${conflict.name}" already exists (UID: ${conflict.uid}). Choose a different name.`,
            );
          }

          const renamed: GroceryList = { ...existing, name: args.newName };

          try {
            const saved = await ctx.infra.client.saveGroceryList(renamed);
            await ctx.writes.commitGroceryList(saved);
            const items = ctx.state.items.store.getByListUid(saved.uid);
            return textResult(groceryListToMarkdown(saved, items));
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid, newName: args.newName }, "saveGroceryList failed");
            return textResult(`Failed to rename grocery list: ${message}`);
          }
        },
        (guard) => guard,
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
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "delete_grocery_list" });
    return async (args) => {
      log.info({ tool: "delete_grocery_list", uid: args.uid }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.lists.store.get(args.uid);

          if (!existing) {
            return textResult(
              `No grocery list found with UID "${args.uid}" (it may not exist or was already deleted).`,
            );
          }

          const trashed: GroceryList = { ...existing, deleted: true };

          try {
            const saved = await ctx.infra.client.saveGroceryList(trashed);
            await ctx.writes.commitGroceryList(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveGroceryList failed");
            return textResult(`Failed to delete grocery list: ${message}`);
          }

          return textResult(`Grocery list "${existing.name}" has been deleted.`);
        },
        (guard) => guard,
      );
    };
  },
);
