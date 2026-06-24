import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { TypedCallToolResult } from "../../../shared/tools.js";
import type { Category } from "../category/types.js";
import type { CategoryUid } from "../ids.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, errorResult, structuredResult } from "../../../shared/tools.js";
import { CategoryUidSchema } from "../ids.js";
import { categoryStartGuard } from "./guards.js";
import { buildCategoryRows, listCategoriesOutputSchema } from "./list-categories.js";

/**
 * Structured-output payload for `create_category` (ADR-0019, R1, B1/#321). No
 * `read_category` tool exists, so this schema is create-only — it surfaces the new
 * category UID (and its parent FK) on the structured channel.
 */
export const createCategoryOutputSchema = z.object({
  uid: CategoryUidSchema,
  name: z.string(),
  parentUid: CategoryUidSchema.nullable().describe("Parent category UID, or null for a top-level category."),
});

function categoryToStructured(category: Category): z.infer<typeof createCategoryOutputSchema> {
  return { uid: category.uid, name: category.name, parentUid: category.parentUid };
}

/** Highest `orderFlag` across all known categories, or -1 when none exist. */
function maxCategoryOrderFlag(state: RecipeState): number {
  let max = -1;
  for (const category of state.category.store.getAll()) {
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
function wouldCreateCycle(state: RecipeState, categoryUid: CategoryUid, newParentUid: CategoryUid): boolean {
  let cursor: CategoryUid | null = newParentUid;
  const seen = new Set<CategoryUid>();
  while (cursor !== null) {
    if (cursor === categoryUid) return true;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent = state.category.store.get(cursor);
    cursor = parent ? parent.parentUid : null;
  }
  return false;
}

/** `create_category` — create a recipe category. */
export const createCategoryTool = defineTool(
  {
    name: "create_category",
    title: "Create a recipe category",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    description:
      "Create a new recipe category. Optionally nest it under an existing category by passing that " +
      "category's UID as `parentUid` to build a hierarchy (e.g. Thai → Curries). Use `list_categories` " +
      "to find parent UIDs. To put recipes in the new category, follow up with `update_recipe`.",
    inputSchema: {
      name: z.string().min(1).describe("Category display name"),
      parentUid: CategoryUidSchema.optional().describe("UID of the parent category to nest under (omit for top-level)"),
    },
    outputSchema: createCategoryOutputSchema,
  },
  [categoryStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "create_category" });
    return async (args) => {
      if (args.parentUid !== undefined && ctx.state.category.store.get(args.parentUid) === undefined) {
        return errorResult(`No category found with UID "${args.parentUid}" to use as a parent.`);
      }

      const category: Category = {
        uid: CategoryUidSchema.parse(crypto.randomUUID().toUpperCase()),
        name: args.name,
        orderFlag: maxCategoryOrderFlag(ctx.state) + 1,
        parentUid: args.parentUid ?? null,
      };

      return (await ctx.infra.client.saveCategory(category)).match(
        async (saved) => {
          const structured = categoryToStructured(saved);
          const commitErr = commitFailure("category", await ctx.writes.commitCategoryUpsert(saved), {
            structuredContent: structured,
          });
          if (commitErr) return commitErr;
          return structuredResult(structured);
        },
        async (e) => {
          log.error({ err: e, name: args.name }, "saveCategory failed");
          return errorResult(`Failed to create category: ${e.message}`);
        },
      );
    };
  },
);

/** `update_category` — rename or re-parent a category. */
export const updateCategoryTool = defineTool(
  {
    name: "update_category",
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
    outputSchema: listCategoriesOutputSchema,
  },
  [categoryStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "update_category" });
    return async (args) => {
      const existing = ctx.state.category.store.get(args.uid);
      if (existing === undefined)
        return errorResult(
          `No category found with UID "${args.uid}" (it may not exist or was already deleted). Use \`list_categories\` to find it.`,
        );

      if (args.name === undefined && args.parentUid === undefined) {
        return errorResult("Nothing to update: provide `name`, `parentUid`, or both.");
      }

      if (typeof args.parentUid === "string") {
        if (args.parentUid === args.uid) {
          return errorResult("A category cannot be its own parent.");
        }
        if (ctx.state.category.store.get(args.parentUid) === undefined) {
          return errorResult(`No category found with UID "${args.parentUid}" to use as a parent.`);
        }
        if (wouldCreateCycle(ctx.state, args.uid, args.parentUid)) {
          return errorResult("That move would create a cycle: the chosen parent is a descendant of this category.");
        }
      }

      const updated: Category = {
        ...existing,
        name: args.name ?? existing.name,
        parentUid: args.parentUid !== undefined ? args.parentUid : existing.parentUid,
      };

      return (await ctx.infra.client.saveCategory(updated)).match(
        async (saved): Promise<TypedCallToolResult<z.infer<typeof listCategoriesOutputSchema>>> => {
          // commitCategoryUpsert persists locally and emits `category-changed` on
          // the kernel re-index seam so discover re-embeds the category's recipes
          // (a rename changes the display name baked into their embedding text).
          // The whole post-commit catalog rides structuredContent (the same full-list
          // shape list_categories produces), so the model sees the reordered tree.
          const commitErr = commitFailure("category", await ctx.writes.commitCategoryUpsert(saved), {
            structuredContent: { items: buildCategoryRows(ctx.state) },
          });
          if (commitErr) return commitErr;
          return structuredResult({ items: buildCategoryRows(ctx.state) });
        },
        async (e) => {
          log.error({ err: e, uid: args.uid }, "saveCategory failed");
          return errorResult(`Failed to update category: ${e.message}`);
        },
      );
    };
  },
);

/** The category create/update registrars, in registration order. */
export const categoryWriteTools = [createCategoryTool, updateCategoryTool];
