/**
 * Smoke test for list_meal_history + lastCookedAt enrichment.
 *
 * Authenticates with real Paprika API, syncs meals/mealtypes/recipes, then
 * exercises:
 *  1. list_meal_history with September 20-26 2020 window
 *  2. list_meal_history filtered by type "Dinner"
 *  3. read_recipe against any recipe that has meal-planner history (lastCookedAt should appear)
 */

import { config } from "dotenv";
import { resolve as resolvePath } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";

config({ path: "/Users/brajkovic/Library/Preferences/mcp-paprika/.env", quiet: true });

const projectRoot = "/Users/brajkovic/Projects/mcp-paprika";
const { PaprikaClient } = await import(resolvePath(projectRoot, "dist/paprika/client.js"));
const { DiskCacheRoot } = await import(resolvePath(projectRoot, "dist/cache/disk/index.js"));
const { RecipeStore } = await import(resolvePath(projectRoot, "dist/recipe/store.js"));
const { MealStore } = await import(resolvePath(projectRoot, "dist/meal/store.js"));
const { MealTypeStore } = await import(resolvePath(projectRoot, "dist/meal-type/store.js"));
const { registerMealHistoryTool } = await import(resolvePath(projectRoot, "dist/tools/meal-history.js"));
const { registerReadTool } = await import(resolvePath(projectRoot, "dist/tools/read.js"));

const log = pino({ level: "warn" });

const email = process.env["PAPRIKA_EMAIL"];
const password = process.env["PAPRIKA_PASSWORD"];
if (!email || !password) {
  console.error("Missing PAPRIKA_EMAIL or PAPRIKA_PASSWORD");
  process.exit(1);
}

console.log("→ Authenticating with Paprika...");
const client = new PaprikaClient(email, password, log);
await client.authenticate();
console.log("✓ Authenticated\n");

console.log("→ Setting up temp disk cache...");
const tempDir = mkdtempSync(join(tmpdir(), "paprika-smoke-"));
const cache = new DiskCacheRoot(tempDir);
await cache.init();
console.log(`  cache dir: ${tempDir}\n`);

console.log("→ Fetching recipes (list + hydrate)...");
const recipeEntries = await client.listRecipes();
console.log(`  ${recipeEntries.length} recipe entries`);
const recipes = await client.getRecipes(recipeEntries.map((e: { uid: string }) => e.uid).slice(0, 50));
console.log(`  fetched ${recipes.length} (first 50 for speed)\n`);

console.log("→ Fetching meals + meal types...");
const meals = await client.listMeals();
const mealTypes = await client.listMealTypes();
console.log(`  ${meals.length} meals, ${mealTypes.length} meal types\n`);

console.log("→ Loading stores...");
const store = new RecipeStore();
store.load(recipes, []);
store.markSynced();
const mealStore = new MealStore();
mealStore.load(meals.filter((m: { deleted?: boolean }) => !m.deleted));
const mealTypeStore = new MealTypeStore();
mealTypeStore.load(mealTypes);
console.log(`  recipe store size: ${store.size}`);
console.log(`  meal store size: ${mealStore.size}`);
console.log(`  meal type store size: ${mealTypeStore.size}\n`);

console.log("→ Meal types loaded:");
for (const mt of mealTypeStore.getAll()) {
  console.log(`  - ${mt.name} (originalType=${mt.originalType}, orderFlag=${mt.orderFlag})`);
}
console.log();

// Build a minimal SessionContext
const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
const server = {
  registerTool(name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
    handlers.set(name, handler);
  },
};
const ctx = {
  client,
  cache,
  store,
  pantryStore: { hasSynced: true } as never,
  aisleStore: { hasSynced: true } as never,
  groceryListStore: { hasSynced: true } as never,
  groceryItemStore: { hasSynced: true } as never,
  groceryIngredientStore: { hasSynced: true } as never,
  mealStore,
  mealTypeStore,
  vectorStore: null,
  notifier: { resourceListChanged: () => {}, loggingMessage: async () => {} },
  auth: null,
  log,
  server: server as never,
};

registerMealHistoryTool(server as never, ctx as never);
registerReadTool(server as never, ctx as never);

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]!.text;
}

console.log("════════════════════════════════════════════════════════════");
console.log("TEST 1: list_meal_history for Sep 20–26, 2020");
console.log("════════════════════════════════════════════════════════════");
const test1 = (await handlers.get("list_meal_history")!({
  since: "2020-09-20",
  until: "2020-09-26",
})) as { content: Array<{ type: string; text: string }> };
console.log(getText(test1));
console.log();

console.log("════════════════════════════════════════════════════════════");
console.log('TEST 2: list_meal_history filtered by type: {name: "Dinner"}');
console.log("════════════════════════════════════════════════════════════");
const test2 = (await handlers.get("list_meal_history")!({
  type: { name: "Dinner" },
  since: "2020-09-20",
  until: "2020-09-26",
})) as { content: Array<{ type: string; text: string }> };
console.log(getText(test2));
console.log();

console.log("════════════════════════════════════════════════════════════");
console.log("TEST 3: list_meal_history filtered by type: {builtin: 0} (Breakfast)");
console.log("════════════════════════════════════════════════════════════");
const test3 = (await handlers.get("list_meal_history")!({
  type: { builtin: 0 },
  since: "2020-09-20",
  until: "2020-09-26",
})) as { content: Array<{ type: string; text: string }> };
console.log(getText(test3));
console.log();

console.log("════════════════════════════════════════════════════════════");
console.log('TEST 4: list_meal_history with unknown type: {name: "Brunch"}');
console.log("════════════════════════════════════════════════════════════");
const test4 = (await handlers.get("list_meal_history")!({
  type: { name: "Brunch" },
})) as { content: Array<{ type: string; text: string }> };
console.log(getText(test4));
console.log();

console.log("════════════════════════════════════════════════════════════");
console.log("TEST 5: find recipe with meal history → read_recipe shows Last Cooked");
console.log("════════════════════════════════════════════════════════════");
// Find a recipeUid that's referenced in meals AND in our loaded recipes
const recipeUidsInMeals = new Set(
  meals
    .filter(
      (m: { recipeUid: string | null; deleted?: boolean; isIngredient: boolean }) =>
        m.recipeUid && !m.deleted && !m.isIngredient,
    )
    .map((m: { recipeUid: string }) => m.recipeUid),
);
const matchingRecipe = recipes.find((r: { uid: string }) => recipeUidsInMeals.has(r.uid));
if (matchingRecipe !== undefined) {
  console.log(`Recipe with meal history: ${matchingRecipe.name} (${matchingRecipe.uid})`);
  console.log(`lastCookedAt: ${mealStore.lastCookedAt(matchingRecipe.uid)}\n`);
  const test5 = (await handlers.get("read_recipe")!({
    uid: matchingRecipe.uid,
  })) as { content: Array<{ type: string; text: string }> };
  const text = getText(test5);
  // Print just the header section
  const lines = text.split("\n");
  const ingIdx = lines.findIndex((l) => l === "## Ingredients");
  console.log(lines.slice(0, ingIdx > 0 ? ingIdx : 20).join("\n"));
  console.log("...[truncated]");
} else {
  console.log("⚠ No recipe in the first 50 has meal history. Trying broader pull...");
  // Pull a recipe that does have meal history
  const targetUid = [...recipeUidsInMeals][0];
  if (targetUid !== undefined) {
    const r = await client.getRecipe(targetUid as string);
    store.set(r);
    console.log(`Recipe with meal history: ${r.name} (${r.uid})`);
    console.log(`lastCookedAt: ${mealStore.lastCookedAt(r.uid)}\n`);
    const test5 = (await handlers.get("read_recipe")!({ uid: r.uid })) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = getText(test5);
    const lines = text.split("\n");
    const ingIdx = lines.findIndex((l) => l === "## Ingredients");
    console.log(lines.slice(0, ingIdx > 0 ? ingIdx : 20).join("\n"));
    console.log("...[truncated]");
  } else {
    console.log("(none found at all)");
  }
}
console.log();

console.log("════════════════════════════════════════════════════════════");
console.log("TEST 6: Cold start guard (meal store not synced)");
console.log("════════════════════════════════════════════════════════════");
const coldMealStore = new MealStore();
const coldCtx = { ...ctx, mealStore: coldMealStore };
const coldHandlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
const coldServer = {
  registerTool(name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
    coldHandlers.set(name, handler);
  },
};
registerMealHistoryTool(coldServer as never, coldCtx as never);
const test6 = (await coldHandlers.get("list_meal_history")!({})) as {
  content: Array<{ type: string; text: string }>;
};
console.log(getText(test6));
console.log();

console.log("✓ All smoke tests complete");
process.exit(0);
