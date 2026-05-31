import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CategoryUidSchema } from "../paprika/types.js";
import type { Category, CategoryUid } from "../paprika/types.js";
import { textResult } from "./helpers.js";
import {
  categoryStartGuard,
  commitCategoryDelete,
  commitCategoryUpsert,
  maxCategoryOrderFlag,
  recipesReferencing,
  wouldCreateCycle,
} from "./category-helpers.js";
import type { ServerContext } from "../types/server-context.js";

function categorySummary(ctx: ServerContext, category: Category): string {
  const parent = category.parentUid ? ctx.categoryStore.get(category.parentUid as CategoryUid) : undefined;
  const parentLine = parent ? ` (under **${parent.name}**)` : " (top-level)";
  return `**${category.name}**${parentLine} — uid: \`${category.uid}\``;
}

export function registerCreateCategoryTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "create_category" });
  server.registerTool(
    "create_category",
    {
      description:
        "Create a new recipe category. Optionally nest it under an existing category by passing that " +
        "category's UID as `parentUid` to build a hierarchy (e.g. Thai → Curries). Use `list_categories` " +
        "to find parent UIDs. To put recipes in the new category, follow up with `update_recipe`.",
      inputSchema: {
        name: z.string().min(1).describe("Category display name"),
        parentUid: z.string().optional().describe("UID of the parent category to nest under (omit for top-level)"),
      },
    },
    async (args) => {
      log.info({ tool: "create_category", name: args.name }, "tool invoked");
      return categoryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (args.parentUid !== undefined && ctx.categoryStore.get(args.parentUid as CategoryUid) === undefined) {
            return textResult(`No category found with UID "${args.parentUid}" to use as a parent.`);
          }

          const category: Category = {
            uid: CategoryUidSchema.parse(crypto.randomUUID().toUpperCase()),
            name: args.name,
            orderFlag: maxCategoryOrderFlag(ctx) + 1,
            parentUid: args.parentUid ?? null,
          };

          try {
            const saved = await ctx.client.saveCategory(category);
            await commitCategoryUpsert(ctx, saved);
            return textResult(`Created category ${categorySummary(ctx, saved)}`);
          } catch (error) {
            log.error({ err: error, name: args.name }, "saveCategory failed");
            return textResult(`Failed to create category: ${toMessage(error)}`);
          }
        },
        (guard) => guard,
      );
    },
  );
}

export function registerUpdateCategoryTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_category" });
  server.registerTool(
    "update_category",
    {
      description:
        "Rename and/or re-parent an existing category. Pass `name` to rename, `parentUid` to move it under " +
        "another category, or `null` for `parentUid` to make it top-level. Re-parenting builds the hierarchy " +
        "that `list_categories` renders.",
      inputSchema: {
        uid: CategoryUidSchema.describe("UID of the category to update"),
        name: z.string().min(1).optional().describe("New display name (omit to leave unchanged)"),
        parentUid: z
          .string()
          .nullable()
          .optional()
          .describe("New parent UID, or null for top-level (omit to leave the parent unchanged)"),
      },
    },
    async (args) => {
      log.info({ tool: "update_category", uid: args.uid }, "tool invoked");
      return categoryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.categoryStore.get(args.uid);
          if (existing === undefined) return textResult(`No category found with UID "${args.uid}".`);

          if (args.name === undefined && args.parentUid === undefined) {
            return textResult("Nothing to update: provide `name`, `parentUid`, or both.");
          }

          if (typeof args.parentUid === "string") {
            if (args.parentUid === args.uid) {
              return textResult("A category cannot be its own parent.");
            }
            if (ctx.categoryStore.get(args.parentUid as CategoryUid) === undefined) {
              return textResult(`No category found with UID "${args.parentUid}" to use as a parent.`);
            }
            if (wouldCreateCycle(ctx, args.uid, args.parentUid)) {
              return textResult("That move would create a cycle: the chosen parent is a descendant of this category.");
            }
          }

          const updated: Category = {
            ...existing,
            name: args.name ?? existing.name,
            parentUid: args.parentUid !== undefined ? args.parentUid : existing.parentUid,
          };

          try {
            const saved = await ctx.client.saveCategory(updated);
            await commitCategoryUpsert(ctx, saved);
            return textResult(`Updated category ${categorySummary(ctx, saved)}`);
          } catch (error) {
            log.error({ err: error, uid: args.uid }, "saveCategory failed");
            return textResult(`Failed to update category: ${toMessage(error)}`);
          }
        },
        (guard) => guard,
      );
    },
  );
}

export function registerDeleteCategoryTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "delete_category" });
  server.registerTool(
    "delete_category",
    {
      description:
        "Delete a category. Refuses if the category still has child categories or is assigned to any recipe — " +
        "reassign or delete those first (move recipes with `update_recipe`, re-parent children with " +
        "`update_category`). This keeps the hierarchy and recipe links consistent.",
      inputSchema: {
        uid: CategoryUidSchema.describe("UID of the category to delete"),
      },
    },
    async (args) => {
      log.info({ tool: "delete_category", uid: args.uid }, "tool invoked");
      return categoryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.categoryStore.get(args.uid);
          if (existing === undefined) {
            return textResult(`No category found with UID "${args.uid}" (already deleted?).`);
          }

          const children = ctx.categoryStore.getChildren(args.uid);
          if (children.length > 0) {
            const names = children.map((c) => `"${c.name}"`).join(", ");
            return textResult(
              `Cannot delete "${existing.name}": it has ${String(children.length)} child ` +
                `categor${children.length === 1 ? "y" : "ies"} (${names}). Re-parent or delete ${
                  children.length === 1 ? "it" : "them"
                } first with \`update_category\`.`,
            );
          }

          const refs = recipesReferencing(ctx, args.uid);
          if (refs.length > 0) {
            return textResult(
              `Cannot delete "${existing.name}": ${String(refs.length)} recipe${refs.length === 1 ? " is" : "s are"} ` +
                `still assigned to it. Reassign ${refs.length === 1 ? "that recipe" : "those recipes"} with ` +
                `\`update_recipe\` first.`,
            );
          }

          try {
            await ctx.client.deleteCategory(existing);
            await commitCategoryDelete(ctx, existing);
            return textResult(`Deleted category "${existing.name}".`);
          } catch (error) {
            log.error({ err: error, uid: args.uid }, "deleteCategory failed");
            return textResult(`Failed to delete category: ${toMessage(error)}`);
          }
        },
        (guard) => guard,
      );
    },
  );
}
