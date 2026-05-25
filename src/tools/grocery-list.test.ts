import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { GroceryListStore } from "../cache/grocery-list-store.js";
import { GroceryItemStore } from "../cache/grocery-item-store.js";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import { registerListGroceryListsTool, registerReadGroceryListTool } from "./grocery-list.js";

describe("list_grocery_lists tool", () => {
  it("grocery-surface.AC1.9: returns sync-not-ready message when stores not loaded", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    // DO NOT call .load() on either store

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.1: returns empty message when no lists exist", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    expect(text).toBe("No grocery lists found.");
  });

  it("grocery-surface.AC1.1: returns list names, UIDs, and item counts", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });

    const item1 = makeGroceryItem({ listUid: listA.uid });
    const item2 = makeGroceryItem({ listUid: listA.uid });
    const item3 = makeGroceryItem({ listUid: listB.uid });

    groceryListStore.load([listA, listB]);
    groceryItemStore.load([item1, item2, item3]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    // Header mentions 2 lists
    expect(text).toContain("You have 2 grocery list(s)");

    // Both list names appear
    expect(text).toContain("Weekly Shopping");
    expect(text).toContain("Costco Run");

    // UIDs appear
    expect(text).toContain(listA.uid);
    expect(text).toContain(listB.uid);

    // Item counts appear
    expect(text).toContain("2 item(s)");
    expect(text).toContain("1 item(s)");
  });

  it("grocery-surface.AC1.1: sorts lists alphabetically by name", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const listZ = makeGroceryList({ name: "Zebra Market" });
    const listA = makeGroceryList({ name: "Aldi Trip" });
    const listM = makeGroceryList({ name: "Monthly Stock" });

    groceryListStore.load([listZ, listA, listM]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    const aldiIdx = text.indexOf("Aldi Trip");
    const monthlyIdx = text.indexOf("Monthly Stock");
    const zebraIdx = text.indexOf("Zebra Market");

    expect(aldiIdx).toBeGreaterThan(-1);
    expect(monthlyIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(aldiIdx).toBeLessThan(monthlyIdx);
    expect(monthlyIdx).toBeLessThan(zebraIdx);
  });
});

describe("read_grocery_list tool", () => {
  it("grocery-surface.AC1.9: returns sync-not-ready message when stores not loaded", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    // DO NOT call .load() on either store

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { uid: "some-uid" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.2: returns not-found when UID does not match any list", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { uid: "nonexistent-uid" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
  });

  it("grocery-surface.AC1.2: returns list metadata and items when fetched by UID", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item1 = makeGroceryItem({ listUid: list.uid, ingredient: "Apples" });
    const item2 = makeGroceryItem({ listUid: list.uid, ingredient: "Milk" });

    groceryListStore.load([list]);
    groceryItemStore.load([item1, item2]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { uid: list.uid });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
    expect(text).toContain("Apples");
    expect(text).toContain("Milk");
  });

  it("grocery-surface.AC1.3: resolves by exact name match", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { name: "Weekly Shopping" });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: resolves by starts-with name match", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { name: "Weekly" });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: resolves by contains name match", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { name: "Shopping" });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: returns not-found when name does not match any list", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([makeGroceryList({ name: "Weekly Shopping" })]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { name: "Completely Different" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
  });

  it("grocery-surface.AC1.3: returns disambiguation when multiple lists match the same tier", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Weekly Costco" });

    groceryListStore.load([listA, listB]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { name: "Weekly" });
    const text = getText(result);

    expect(text).toContain("Multiple grocery lists match");
    expect(text).toContain(listA.uid);
    expect(text).toContain(listB.uid);
    expect(text).toContain("Please re-invoke with a specific uid");
  });

  it("grocery-surface.AC1.2: requires at least one of uid or name", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", {});
    const text = getText(result);

    expect(text.toLowerCase()).toContain("uid or name");
  });
});
