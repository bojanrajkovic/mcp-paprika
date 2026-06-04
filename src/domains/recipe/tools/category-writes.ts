import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { CategoryUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { Category } from "../category/types.js";
import type { RecipeSelf } from "../module.js";

import { CategoryUidSchema } from "../../../ids.js";
import { textResult } from "../../../tools/helpers.js";
import { toMessage } from "../../../utils/log.js";
import { categoryStartGuard } from "./guards.js";

function categorySummary(self: RecipeSelf, category: Category): string {
  const parent = category.parentUid ? self.category.store.get(category.parentUid) : undefined;
  const parentLine = parent ? ` (under **${parent.name}**)` : " (top-level)";
  return `**${category.name}**${parentLine} — uid: \`${category.uid}\``;
}

/** Highest `orderFlag` across all known categories, or -1 when none exist. */
function maxCategoryOrderFlag(self: RecipeSelf): number {
  let max = -1;
  for (const category of self.category.store.getAll()) {
    if (category.orderFlag > max) max = category.orderFlag;
  }
  return max;
}

/**
 * True if re-parenting `categoryUid` under `newParentUid` would create a cycle —
 * i.e. `newParentUid` is the category itself or one of its descendants. Walks up
 * the parent chain from `newParentUid`; if it reaches `categoryUid`, the new parent
 * sits below the category, so the link would close a loop. The `seen` set guards
 * against an already-corrupt chain looping forever.
 */
function wouldCreateCycle(self: RecipeSelf, categoryUid: CategoryUid, newParentUid: CategoryUid): boolean {
  let cursor: CategoryUid | null = newParentUid;
  const seen = new Set<CategoryUid>();
  while (cursor !== null) {
    if (cursor === categoryUid) return true;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent = self.category.store.get(cursor);
    cursor = parent ? parent.parentUid : null;
  }
  return false;
}

/** Registers `create_category`, kernel-shaped — writes through `ctx.self.commitCategoryUpsert`. */
export function createCategoryTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "create_category" });
  ctx.server.registerTool(
    "create_category",
    {
      title: "Create a recipe category",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description:
        "Create a new recipe category. Optionally nest it under an existing category by passing that " +
        "category's UID as `parentUid` to build a hierarchy (e.g. Thai → Curries). Use `list_categories` " +
        "to find parent UIDs. To put recipes in the new category, follow up with `update_recipe`.",
      inputSchema: {
        name: z.string().min(1).describe("Category display name"),
        parentUid: CategoryUidSchema.optional().describe(
          "UID of the parent category to nest under (omit for top-level)",
        ),
      },
    },
    async (args) => {
      log.info({ tool: "create_category", name: args.name }, "tool invoked");
      return categoryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          if (args.parentUid !== undefined && ctx.self.category.store.get(args.parentUid) === undefined) {
            return textResult(`No category found with UID "${args.parentUid}" to use as a parent.`);
          }

          const category: Category = {
            uid: CategoryUidSchema.parse(crypto.randomUUID().toUpperCase()),
            name: args.name,
            orderFlag: maxCategoryOrderFlag(ctx.self) + 1,
            parentUid: args.parentUid ?? null,
          };

          try {
            const saved = await ctx.infra.client.saveCategory(category);
            await ctx.self.commitCategoryUpsert(saved);
            return textResult(`Created category ${categorySummary(ctx.self, saved)}`);
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

/** Registers `update_category`, kernel-shaped — rename/re-parent through `ctx.self.commitCategoryUpsert`. */
export function updateCategoryTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "update_category" });
  ctx.server.registerTool(
    "update_category",
    {
      title: "Rename or re-parent a recipe category",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description:
        "Rename and/or re-parent an existing category. Pass `name` to rename, `parentUid` to move it under " +
        "another category, or `null` for `parentUid` to make it top-level. Re-parenting builds the hierarchy " +
        "that `list_categories` renders.",
      inputSchema: {
        uid: CategoryUidSchema.describe("UID of the category to update"),
        name: z.string().min(1).optional().describe("New display name (omit to leave unchanged)"),
        parentUid: CategoryUidSchema.nullable()
          .optional()
          .describe("New parent UID, or null for top-level (omit to leave the parent unchanged)"),
      },
    },
    async (args) => {
      log.info({ tool: "update_category", uid: args.uid }, "tool invoked");
      return categoryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.category.store.get(args.uid);
          if (existing === undefined) return textResult(`No category found with UID "${args.uid}".`);

          if (args.name === undefined && args.parentUid === undefined) {
            return textResult("Nothing to update: provide `name`, `parentUid`, or both.");
          }

          if (typeof args.parentUid === "string") {
            if (args.parentUid === args.uid) {
              return textResult("A category cannot be its own parent.");
            }
            if (ctx.self.category.store.get(args.parentUid) === undefined) {
              return textResult(`No category found with UID "${args.parentUid}" to use as a parent.`);
            }
            if (wouldCreateCycle(ctx.self, args.uid, args.parentUid)) {
              return textResult("That move would create a cycle: the chosen parent is a descendant of this category.");
            }
          }

          const updated: Category = {
            ...existing,
            name: args.name ?? existing.name,
            parentUid: args.parentUid !== undefined ? args.parentUid : existing.parentUid,
          };

          try {
            const saved = await ctx.infra.client.saveCategory(updated);
            // commitCategoryUpsert persists locally; the category re-embed (a rename
            // changes the display name baked into recipes' embedding text) is a FLIP
            // item — see the `// FLIP:` marker in module.ts. App-side renames are
            // handled by the sync:category-change event (also a FLIP channel).
            await ctx.self.commitCategoryUpsert(saved);
            return textResult(`Updated category ${categorySummary(ctx.self, saved)}`);
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

/** The category create/update registrars, in registration order. */
export const categoryWriteTools = [createCategoryTool, updateCategoryTool];
