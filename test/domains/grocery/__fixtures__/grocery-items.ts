import type { GroceryItem } from "../../../../src/domains/grocery/grocery-item/types.js";
import type { AisleUid, GroceryItemUid, GroceryListUid } from "../../../../src/ids.js";

let groceryItemCounter = 0;

type GroceryItemOverrides = Partial<Omit<GroceryItem, "aisleUid" | "listUid">> & {
  readonly aisleUid?: string;
  readonly listUid?: string;
};

export function makeGroceryItem(overrides?: GroceryItemOverrides): GroceryItem {
  groceryItemCounter += 1;
  const { aisleUid, listUid, ...rest } = overrides ?? {};
  return {
    uid: `grocery-item-${groceryItemCounter.toString()}` as GroceryItemUid,
    name: `Test Ingredient ${groceryItemCounter.toString()}`,
    ingredient: `Test Ingredient ${groceryItemCounter.toString()}`,
    aisle: "Produce",
    aisleUid: (aisleUid ?? "aisle-1") as AisleUid,
    listUid: (listUid ?? "list-1") as GroceryListUid,
    purchased: false,
    deleted: false,
    orderFlag: 0,
    quantity: "",
    instruction: "",
    recipe: null,
    separate: false,
    ...rest,
  };
}
