import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GroceryListUidSchema } from "../paprika/types.js";
import type { GroceryList } from "../paprika/types.js";
import { groceryStartGuard, groceryListToMarkdown, commitGroceryList } from "./grocery-helpers.js";
import { textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerListGroceryListsTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "list_grocery_lists" });
  server.registerTool(
    "list_grocery_lists",
    {
      description: "List all grocery lists sorted alphabetically by name, with UID and item count per list.",
      inputSchema: {},
    },
    async () => {
      log.info({ tool: "list_grocery_lists" }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const all = ctx.groceryListStore.getAll().sort((a, b) => a.name.localeCompare(b.name));
          const total = all.length;

          if (total === 0) {
            return textResult("No grocery lists found.");
          }

          const header = `You have ${total.toString()} grocery list(s):`;
          const lines = all.map((list) => {
            const itemCount = ctx.groceryItemStore.getByListUid(list.uid).length;
            return `- **${list.name}** — ${itemCount.toString()} item(s) (uid: \`${list.uid}\`)`;
          });

          return textResult(header + "\n\n" + lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}

export function registerReadGroceryListTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "read_grocery_list" });
  server.registerTool(
    "read_grocery_list",
    {
      description:
        "Get a grocery list by UID or name. Name lookup is tiered (exact → starts-with → contains) " +
        "and case-insensitive, with a disambiguation list when multiple lists match the same tier. " +
        'Pass exactly one shape: {"uid": "..."} or {"name": "..."}.',
      inputSchema: {
        lookup: z
          .union([
            z
              .object({ uid: z.string().min(1) })
              .strict()
              .describe('Exact grocery list UID, e.g. {"uid": "..."}.'),
            z
              .object({ name: z.string().min(1) })
              .strict()
              .describe('Grocery list name fuzzy match, e.g. {"name": "Weekly Shopping"}.'),
          ])
          .describe('Pick exactly one shape: {"uid": "..."} or {"name": "..."}.'),
      },
    },
    async (args) => {
      log.info({ tool: "read_grocery_list", ...args.lookup }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if ("uid" in args.lookup) {
            const list = ctx.groceryListStore.get(GroceryListUidSchema.parse(args.lookup.uid));
            if (!list) {
              return textResult(`No grocery list found with UID "${args.lookup.uid}".`);
            }
            const items = ctx.groceryItemStore.getByListUid(list.uid);
            return textResult(groceryListToMarkdown(list, items));
          }

          const name = args.lookup.name;
          const matches = ctx.groceryListStore.findByName(name);

          if (matches.length === 0) {
            return textResult(`No grocery list found matching "${name}".`);
          }

          if (matches.length === 1) {
            const list = matches[0]!;
            const items = ctx.groceryItemStore.getByListUid(list.uid);
            return textResult(groceryListToMarkdown(list, items));
          }

          const lines = matches.map((list) => `- **${list.name}** (uid: \`${list.uid}\`)`).join("\n");
          return textResult(
            `Multiple grocery lists match "${name}":\n${lines}\n\nPlease re-invoke with a specific uid.`,
          );
        },
        (guard) => guard,
      );
    },
  );
}

export function registerCreateGroceryListTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "create_grocery_list" });
  server.registerTool(
    "create_grocery_list",
    {
      description:
        "Create a new grocery list with the given name. Rejects duplicate names (case-insensitive exact match); " +
        "if a duplicate is found, the response includes the existing UID.",
      inputSchema: {
        name: z.string().min(1).describe("Grocery list name (required)"),
      },
    },
    async (args) => {
      log.info({ tool: "create_grocery_list", name: args.name }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Duplicate-name guard: only reject on exact case-insensitive match.
          // A starts-with or contains hit from findByName is NOT a duplicate.
          const matches = ctx.groceryListStore.findByName(args.name);
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
            const saved = await ctx.client.saveGroceryList(newList);
            await commitGroceryList(ctx, saved);
            return textResult(groceryListToMarkdown(saved, []));
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, name: args.name }, "saveGroceryList failed");
            return textResult(`Failed to create grocery list: ${message}`);
          }
        },
        (guard) => guard,
      );
    },
  );
}

export function registerRenameGroceryListTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "rename_grocery_list" });
  server.registerTool(
    "rename_grocery_list",
    {
      description: "Rename a grocery list. Rejects if the new name conflicts with a different existing list.",
      inputSchema: {
        uid: z.string().describe("Grocery list UID to rename"),
        newName: z.string().min(1).describe("New name for the grocery list"),
      },
    },
    async (args) => {
      log.info({ tool: "rename_grocery_list", uid: args.uid, newName: args.newName }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = GroceryListUidSchema.parse(args.uid);
          const existing = ctx.groceryListStore.get(uid);

          if (!existing) {
            return textResult(`No grocery list found with UID "${args.uid}".`);
          }

          // Same-name no-op: case-insensitive check. Return the existing list rendered as markdown.
          if (existing.name.toLowerCase() === args.newName.toLowerCase()) {
            const items = ctx.groceryItemStore.getByListUid(existing.uid);
            return textResult(groceryListToMarkdown(existing, items));
          }

          // Conflict check: reject if another list (different UID) has the exact same name.
          const conflictMatches = ctx.groceryListStore.findByName(args.newName);
          const conflict = conflictMatches.find(
            (l) => l.name.toLowerCase() === args.newName.toLowerCase() && l.uid !== uid,
          );
          if (conflict !== undefined) {
            return textResult(
              `A grocery list named "${conflict.name}" already exists (UID: ${conflict.uid}). Choose a different name.`,
            );
          }

          const renamed: GroceryList = { ...existing, name: args.newName };

          try {
            const saved = await ctx.client.saveGroceryList(renamed);
            await commitGroceryList(ctx, saved);
            const items = ctx.groceryItemStore.getByListUid(saved.uid);
            return textResult(groceryListToMarkdown(saved, items));
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid, newName: args.newName }, "saveGroceryList failed");
            return textResult(`Failed to rename grocery list: ${message}`);
          }
        },
        (guard) => guard,
      );
    },
  );
}

export function registerDeleteGroceryListTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "delete_grocery_list" });
  server.registerTool(
    "delete_grocery_list",
    {
      description: "Delete a grocery list by UID.",
      inputSchema: {
        uid: z.string().describe("Grocery list UID to delete"),
      },
    },
    async (args) => {
      log.info({ tool: "delete_grocery_list", uid: args.uid }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = GroceryListUidSchema.parse(args.uid);
          const existing = ctx.groceryListStore.get(uid);

          if (!existing) {
            // Distinguish "deleted in this session" (tombstone) from "never existed".
            if (ctx.groceryListStore.isTombstone(uid)) {
              return textResult(`Grocery list with UID "${args.uid}" is already deleted.`);
            }
            return textResult(`No grocery list found with UID "${args.uid}".`);
          }

          if (existing.deleted) {
            // Defense-in-depth: if a tombstone lands in the items map (e.g. from a
            // future sync that returns deleted lists), still report already-deleted.
            return textResult(`Grocery list "${existing.name}" is already deleted.`);
          }

          const trashed: GroceryList = { ...existing, deleted: true };

          try {
            const saved = await ctx.client.saveGroceryList(trashed);
            await commitGroceryList(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveGroceryList failed");
            return textResult(`Failed to delete grocery list: ${message}`);
          }

          return textResult(`Grocery list "${existing.name}" has been deleted.`);
        },
        (guard) => guard,
      );
    },
  );
}
