import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RecipeUid } from "./ids.js";
import type { Infra, Kernel } from "./kernel/registry.js";
import type { PaprikaConfig } from "./utils/config.js";

import { makeCategory, makeSnakeCaseRecipe } from "../test/domains/recipe/__fixtures__/recipes.js";
import { useTempDir } from "../test/support/disk-caches.js";
import { getText, makeStubNotifier, makeTestServer } from "../test/support/tool-test-utils.js";
import { GeneratedImageStore } from "./features/generated-image-store.js";
import { buildKernel } from "./kernel/registry.js";
import { PaprikaClient } from "./paprika/client.js";
import { createIndexEvents } from "./server/index-events.js";
import { SILENT_LOG } from "./utils/log.js";
// Side-effect: register every kernel module so buildKernel's default module list is populated.
import "./kernel/modules.generated.js";

const API_BASE = "https://paprikaapp.com/api/v2/sync";

const server = setupServer();
const tmp = useTempDir("paprika-sync-tool-");

beforeAll(() => {
  server.listen();
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await tmp.setup();
  server.resetHandlers();
  // Baseline handlers: always-empty endpoints every test needs. Individual tests
  // override only what they care about via server.use() (last-registered wins in MSW).
  server.use(
    http.get(`${API_BASE}/recipes/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/categories/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/groceryaisles/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/pantry/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/grocerylists/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/groceries/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/groceryingredients/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/mealtypes/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/meals/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/menus/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/menuitems/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/photos/`, () => HttpResponse.json({ result: [] })),
  );
});

afterEach(async () => {
  await tmp.teardown();
});

// A kernel Infra over the MSW-backed real PaprikaClient: features off, a stub notifier,
// silent logs, the per-test temp cache dir. `buildKernel(infra)` constructs every module
// (each hydrates its own cache), runs the INITIAL sync cycle against MSW, and returns a
// per-session registrar — the production composition path the transports use. AC1–AC4
// exercise that path end-to-end (sync populating the stores → registered tools reading
// them). The per-module #57 reconcile coverage lives in the focused kernel sync tests
// (recipe-sync.test.ts + the syncReplaceAllEntity tests in paprika/sync.test.ts).
const KERNEL_TEST_CONFIG = {
  transport: "stdio",
  sync: { enabled: true, pendingWriteTtl: 60_000, interval: 60_000, recipeFetchConcurrency: 4 },
} as unknown as PaprikaConfig;

async function buildKernelHarness(): Promise<{
  kernel: Kernel;
  callTool: ReturnType<typeof makeTestServer>["callTool"];
}> {
  const infra: Infra = {
    client: new PaprikaClient("test@example.com", "password"),
    cacheDir: tmp.dir(),
    notifier: makeStubNotifier().notifier,
    log: SILENT_LOG,
    config: KERNEL_TEST_CONFIG,
    indexEvents: createIndexEvents(SILENT_LOG),
    generatedImageStore: new GeneratedImageStore(),
  };
  const kernel = await buildKernel(infra);
  const { server: mcp, callTool } = makeTestServer();
  kernel.registerAll(mcp);
  return { kernel, callTool };
}

describe("Sync → Tool Pipeline Integration", () => {
  describe("AC1: Basic sync and query flow", () => {
    it("AC1.1: the initial sync populates the stores, then tools query the synced data", async () => {
      server.use(
        http.get(`${API_BASE}/recipes/`, () =>
          HttpResponse.json({
            result: [
              { uid: "recipe-1", hash: "hash-1" },
              { uid: "recipe-2", hash: "hash-2" },
            ],
          }),
        ),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) =>
          HttpResponse.json({
            result: makeSnakeCaseRecipe(params["uid"] as string, {
              ingredients: params["uid"] === "recipe-1" ? "eggs, flour" : "chocolate, butter",
              name: params["uid"] === "recipe-1" ? "Scrambled Eggs" : "Chocolate Cake",
            }),
          }),
        ),
      );

      // buildKernel runs the initial sync cycle, pulling both recipes from MSW into the
      // recipe module's store; registerAll then wires the tools to read that same store.
      const { callTool } = await buildKernelHarness();

      const searchResult = await callTool("search_recipes", { query: "chocolate", limit: 20 });
      expect(getText(searchResult)).toContain("Chocolate Cake");

      const readResult = await callTool("read_recipe", { lookup: { uid: "recipe-1" as RecipeUid } });
      expect(getText(readResult)).toContain("Scrambled Eggs");
    });

    // The before-sync cold-start guard ("try again") is a tool concern, covered by the
    // recipe search unit test (src/recipe/tools/search.test.ts) — buildKernel always runs
    // an initial sync, so an un-synced store is not reachable through this path.
  });

  describe("AC2: Multiple sync cycles with data changes", () => {
    it("AC2.1: a second sync cycle adds a new recipe; tools reflect the change", async () => {
      let syncCount = 0;
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          // First cycle: 1 recipe; second cycle: 2 recipes.
          const recipes =
            syncCount === 0
              ? [{ uid: "recipe-1", hash: "hash-1" }]
              : [
                  { uid: "recipe-1", hash: "hash-1" },
                  { uid: "recipe-2", hash: "hash-2-updated" },
                ];
          syncCount++;
          return HttpResponse.json({ result: recipes });
        }),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) =>
          HttpResponse.json({
            result: makeSnakeCaseRecipe(params["uid"] as string, {
              name: params["uid"] === "recipe-1" ? "Pasta" : "Salad",
            }),
          }),
        ),
      );

      // Initial cycle (run inside buildKernel): only recipe-1.
      const { kernel, callTool } = await buildKernelHarness();
      expect(getText(await callTool("search_recipes", { query: "salad", limit: 20 })).toLowerCase()).toContain(
        "no recipes",
      );

      // Second cycle: recipe-2 ("Salad") appears.
      await kernel.syncOnce();
      expect(getText(await callTool("search_recipes", { query: "salad", limit: 20 }))).toContain("Salad");
    });

    it("AC2.2: a second sync cycle removes a recipe; tools no longer return it", async () => {
      let syncCount = 0;
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          // First cycle: 2 recipes; second cycle: 1 recipe (recipe-2 removed).
          const recipes =
            syncCount === 0
              ? [
                  { uid: "recipe-1", hash: "hash-1" },
                  { uid: "recipe-2", hash: "hash-2" },
                ]
              : [{ uid: "recipe-1", hash: "hash-1" }];
          syncCount++;
          return HttpResponse.json({ result: recipes });
        }),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) =>
          HttpResponse.json({
            result: makeSnakeCaseRecipe(params["uid"] as string, {
              name: params["uid"] === "recipe-1" ? "Pasta" : "Salad",
            }),
          }),
        ),
      );

      const { kernel, callTool } = await buildKernelHarness(); // cycle 1: both recipes
      await kernel.syncOnce(); // cycle 2: recipe-2 dropped

      expect(getText(await callTool("search_recipes", { query: "pasta", limit: 20 }))).toContain("Pasta");
      expect(getText(await callTool("search_recipes", { query: "salad", limit: 20 })).toLowerCase()).toContain(
        "no recipes",
      );
    });
  });

  describe("AC3: Tool variety after sync", () => {
    it("AC3.1: multiple tools work with synced recipes (search, read, list_categories, ingredient filter)", async () => {
      const category = makeCategory({ name: "Breakfast" });
      server.use(
        http.get(`${API_BASE}/recipes/`, () =>
          HttpResponse.json({
            result: [
              { uid: "eggs", hash: "hash-eggs" },
              { uid: "toast", hash: "hash-toast" },
            ],
          }),
        ),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) => {
          const recipe =
            params["uid"] === "eggs"
              ? makeSnakeCaseRecipe("eggs", {
                  name: "Scrambled Eggs",
                  ingredients: "eggs, butter, salt",
                  categories: [category.uid],
                })
              : makeSnakeCaseRecipe("toast", {
                  name: "French Toast",
                  ingredients: "bread, eggs, milk",
                  categories: [category.uid],
                });
          return HttpResponse.json({ result: recipe });
        }),
        http.get(`${API_BASE}/categories/`, () =>
          HttpResponse.json({
            result: [{ uid: category.uid, name: category.name, order_flag: 1, parent_uid: null }],
          }),
        ),
      );

      // buildKernel syncs recipes AND categories; the recipe module resolves category
      // names through its own synced category store, so read_recipe shows "Breakfast".
      const { callTool } = await buildKernelHarness();

      expect(getText(await callTool("search_recipes", { query: "eggs", limit: 20 }))).toContain("Scrambled Eggs");

      const readResult = await callTool("read_recipe", { lookup: { uid: "eggs" as RecipeUid } });
      expect(getText(readResult)).toContain("Scrambled Eggs");
      expect(getText(readResult)).toContain("Breakfast");

      const listText = getText(await callTool("list_categories", {}));
      expect(listText).toContain("Breakfast");
      expect(listText).toContain("2"); // 2 recipes in the category

      const filterText = getText(await callTool("search_recipes", { ingredients: ["eggs"], match: "any", limit: 20 }));
      expect(filterText).toContain("Scrambled Eggs");
      expect(filterText).toContain("French Toast");
    });
  });

  describe("AC4: Recipe mutation and sync", () => {
    it("AC4.1: a recipe change pulled by a later sync is reflected in tools", async () => {
      // A mutable name + hash: the diff re-fetches only when the hash changes.
      let recipeName = "Original Name";
      let recipesHash = "hash-original";
      server.use(
        http.get(`${API_BASE}/recipes/`, () => HttpResponse.json({ result: [{ uid: "recipe-1", hash: recipesHash }] })),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) =>
          HttpResponse.json({ result: makeSnakeCaseRecipe(params["uid"] as string, { name: recipeName }) }),
        ),
      );

      const { kernel, callTool } = await buildKernelHarness(); // cycle 1: "Original Name"
      expect(getText(await callTool("search_recipes", { query: "updated", limit: 20 })).toLowerCase()).toContain(
        "no recipes",
      );

      // Mutate the server: a new name behind a new hash so the diff detects the change.
      recipeName = "Updated Name";
      recipesHash = "hash-updated";
      await kernel.syncOnce(); // cycle 2: re-fetch

      expect(getText(await callTool("search_recipes", { query: "updated", limit: 20 }))).toContain("Updated Name");
    });
  });
});
