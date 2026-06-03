import { fromAny } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeedData } from "../../test/support/tool-test-utils.js";
import type { AisleUid, GroceryItemUid, GroceryListUid } from "../ids.js";

import { makeAisle } from "../../test/cache/__fixtures__/aisles.js";
import { makeGroceryItem } from "../../test/cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../test/cache/__fixtures__/grocery-lists.js";
import { getText, makeCtx, makeStubNotifier, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { markGroceryItemPurchasedInputSchema, registerMarkGroceryItemPurchasedTool } from "./grocery-item-purchase.js";

const WEEKLY_LIST = makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" });
const PRODUCE_AISLE = makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" });

describe("mark_grocery_item_purchased tool", () => {
  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPutGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPutGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  function makePurchaseCtx(seedOverrides?: SeedData) {
    const { notifier, resourceListChanged } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    seed(ctx, {
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [],
      ...seedOverrides,
    });
    registerMarkGroceryItemPurchasedTool(server, ctx);
    return { server, callTool, notifier, resourceListChanged, ctx };
  }

  it("happy path: marks an unpurchased item as purchased", async () => {
    const item = makeGroceryItem({
      uid: "ITEM-1" as GroceryItemUid,
      ingredient: "Milk",
      listUid: "LIST-1",
      purchased: false,
    });
    mockSaveGroceryItems = vi.fn().mockResolvedValue([{ ...item, purchased: true }]);
    const { callTool } = makePurchaseCtx({ groceryItems: [item] });

    const result = await callTool("mark_grocery_item_purchased", { uid: "ITEM-1" });
    const text = getText(result);

    expect(text).toContain("Milk");
    expect(text).toContain("Yes"); // Purchased: Yes
    expect(mockSaveGroceryItems).toHaveBeenCalledWith([expect.objectContaining({ purchased: true })]);
  });

  it("not-found: unknown uid returns error message", async () => {
    const { callTool } = makePurchaseCtx();

    const result = await callTool("mark_grocery_item_purchased", { uid: "UNKNOWN-UID" });
    const text = getText(result);

    expect(text).toContain("No grocery item found with UID");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("schema hard-reject: purchased field is rejected on this tool's input schema", () => {
    expect(markGroceryItemPurchasedInputSchema.safeParse({ uid: "X", purchased: true }).success).toBe(false);
  });
});
