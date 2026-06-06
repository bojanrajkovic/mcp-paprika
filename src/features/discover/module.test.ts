import { fromAny } from "@total-typescript/shoehorn";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { CategoryUid, RecipeUid } from "../../domains/recipe/ids.js";
import type { Recipe } from "../../domains/recipe/types.js";
import type { Infra } from "../../kernel/registry.js";
import type { VectorStore, VectorStoreFailure } from "../vector-store.js";

import { makeRecipe } from "../../../test/domains/recipe/__fixtures__/recipes.js";
import { makeKernelInfra } from "../../../test/support/kernel-harness.js";
import { makePinoCapture } from "../../../test/support/tool-test-utils.js";
import { registeredModules } from "../../kernel/registry.js";
import { VectorStoreError } from "../vector-store-errors.js";
// Side-effect: register every module so `registeredModules()` can resolve "discover".
import "../../kernel/modules.generated.js";

/**
 * Unit coverage for the discover module's `index` boot hook (src/features/discover/module.ts):
 * the post-sync startup reconcile and the live `infra.indexEvents` re-index subscription.
 * The `discover_recipes` tool surface is covered separately in `tools/discover-recipes.test.ts`.
 *
 * The hook reads only `state.vectorStore`, three methods off `deps.recipe`, and
 * `infra.indexEvents`, so each test builds the discover module with embeddings OFF (a `null`
 * vectorStore), injects a mock vectorStore into `state`, stubs `deps.recipe`, and invokes the
 * hook directly — exactly the `BootCtx` the kernel hands it post-sync.
 */

/** A mock VectorStore exposing only what the `index` hook touches. `size` drives the rebuild threshold. */
function makeMockVectorStore(size = 0) {
  return {
    indexRecipes: vi
      .fn<(recipes: ReadonlyArray<Recipe>, resolveNames: unknown) => ResultAsync<unknown, VectorStoreFailure>>()
      .mockReturnValue(okAsync(undefined)),
    removeRecipe: vi.fn<(uid: string) => ResultAsync<void, VectorStoreFailure>>().mockReturnValue(okAsync(undefined)),
    clearHashes: vi.fn<() => void>(),
    size,
  };
}
type MockVectorStore = ReturnType<typeof makeMockVectorStore>;

/** The slice of the recipe contract the hook consumes: `size`, `getAll`, `resolveCategoryNames`. */
function makeRecipeDeps(recipes: ReadonlyArray<Recipe>) {
  return {
    size: () => recipes.length,
    getAll: () => recipes,
    // Passed through to indexRecipes as the resolver; the mock never invokes it.
    resolveCategoryNames: (uids: ReadonlyArray<CategoryUid>) => uids.map((u) => String(u)),
  };
}

/** Let the fire-and-forget event handlers (unawaited async IIFEs) settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

/**
 * Build discover (features OFF → null vectorStore), inject `mockVs`, stub `deps.recipe` with
 * `recipes`, then run the `index` boot hook. Returns the `infra` (to emit re-index events on)
 * and the captured log records.
 */
async function runIndexBoot(
  recipes: ReadonlyArray<Recipe>,
  mockVs: MockVectorStore,
): Promise<{ infra: Infra; records: ReadonlyArray<Record<string, unknown>> }> {
  const { log, records } = makePinoCapture();
  const infra: Infra = { ...makeKernelInfra({ cacheDir: "/discover-index-boot-test-unused" }), log };
  const discoverModule = registeredModules().find((m) => m.id === "discover")!;
  const built = await discoverModule.build(infra);
  (built.state as { vectorStore: VectorStore | null }).vectorStore = fromAny(mockVs);
  await built.onReady!.index!({ state: built.state, deps: { recipe: makeRecipeDeps(recipes) }, infra });
  return { infra, records };
}

const reindexErrors = (records: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<Record<string, unknown>> =>
  records.filter((r) => r["msg"] === "vector index error during re-index");

describe("discover module — index boot hook (#177)", () => {
  describe("startup reconcile", () => {
    it("indexes the full store and clears hashes when the vector index is empty", async () => {
      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      const mockVs = makeMockVectorStore(0);

      await runIndexBoot([recipe], mockVs);

      expect(mockVs.clearHashes).toHaveBeenCalled();
      expect(mockVs.indexRecipes).toHaveBeenCalledTimes(1);
      expect(mockVs.indexRecipes.mock.calls[0]![0]).toEqual([recipe]);
      expect(typeof mockVs.indexRecipes.mock.calls[0]![1]).toBe("function");
    });

    it("reconciles WITHOUT clearing hashes when the index is already healthy (>= 90%)", async () => {
      const recipes = Array.from({ length: 10 }, (_, i) => makeRecipe({ uid: `recipe-${String(i)}` as RecipeUid }));
      const mockVs = makeMockVectorStore(10);

      await runIndexBoot(recipes, mockVs);

      // A category renamed while the server was down changes no recipe hash, so the
      // reconcile still runs (indexRecipes skips unchanged recipes by hash) — but a
      // healthy index needs no full wipe.
      expect(mockVs.clearHashes).not.toHaveBeenCalled();
      expect(mockVs.indexRecipes).toHaveBeenCalledTimes(1);
    });

    it("clears hashes and rebuilds when the index is stale (< 90% of the store)", async () => {
      const recipes = Array.from({ length: 100 }, (_, i) => makeRecipe({ uid: `recipe-${String(i)}` as RecipeUid }));
      const mockVs = makeMockVectorStore(2);

      await runIndexBoot(recipes, mockVs);

      expect(mockVs.clearHashes).toHaveBeenCalled();
      expect(mockVs.indexRecipes).toHaveBeenCalledTimes(1);
    });

    it("skips indexing entirely when the recipe store is empty", async () => {
      const mockVs = makeMockVectorStore(0);

      await runIndexBoot([], mockVs);

      expect(mockVs.clearHashes).not.toHaveBeenCalled();
      expect(mockVs.indexRecipes).not.toHaveBeenCalled();
    });
  });

  describe("live re-index subscription", () => {
    it("recipe-changed re-embeds the changed recipes", async () => {
      const r1 = makeRecipe({ uid: "r1" as RecipeUid });
      const r2 = makeRecipe({ uid: "r2" as RecipeUid });
      const mockVs = makeMockVectorStore(10); // healthy index — isolate the event-driven call
      const { infra } = await runIndexBoot([r1, r2], mockVs);
      mockVs.indexRecipes.mockClear(); // discard the startup-reconcile call

      infra.indexEvents.emit({ type: "recipe-changed", recipes: [r1, r2] });
      await settle();

      expect(mockVs.indexRecipes).toHaveBeenCalledTimes(1);
      expect(mockVs.indexRecipes.mock.calls[0]![0]).toEqual([r1, r2]);
    });

    it("recipe-removed removes each uid from the index", async () => {
      const mockVs = makeMockVectorStore(10);
      const { infra } = await runIndexBoot([], mockVs);

      infra.indexEvents.emit({ type: "recipe-removed", uids: ["uid1" as RecipeUid, "uid2" as RecipeUid] });
      await settle();

      expect(mockVs.removeRecipe).toHaveBeenCalledTimes(2);
      expect(mockVs.removeRecipe).toHaveBeenCalledWith("uid1");
      expect(mockVs.removeRecipe).toHaveBeenCalledWith("uid2");
    });

    it("an empty recipe-changed cycle indexes nothing (after a successful startup reconcile)", async () => {
      const mockVs = makeMockVectorStore(10);
      const { infra } = await runIndexBoot([makeRecipe({ uid: "r1" as RecipeUid })], mockVs);
      mockVs.indexRecipes.mockClear();

      infra.indexEvents.emit({ type: "recipe-changed", recipes: [] });
      await settle();

      expect(mockVs.indexRecipes).not.toHaveBeenCalled();
    });

    it("category-changed re-embeds only the recipes referencing a changed category", async () => {
      const catA = "CAT-A" as CategoryUid;
      const catB = "CAT-B" as CategoryUid;
      const catC = "CAT-C" as CategoryUid;
      const recipes = [
        makeRecipe({ uid: "r1" as RecipeUid, categories: [catA] }),
        makeRecipe({ uid: "r2" as RecipeUid, categories: [catB] }),
        makeRecipe({ uid: "r3" as RecipeUid, categories: [catA, catC] }),
      ];
      const mockVs = makeMockVectorStore(10);
      const { infra } = await runIndexBoot(recipes, mockVs);
      mockVs.indexRecipes.mockClear();

      infra.indexEvents.emit({ type: "category-changed", uids: [catA] });
      await settle();

      expect(mockVs.indexRecipes).toHaveBeenCalledTimes(1);
      const indexed = mockVs.indexRecipes.mock.calls[0]![0] as ReadonlyArray<Recipe>;
      expect(indexed.map((r) => r.uid).sort()).toEqual(["r1", "r3"]);
    });

    it("category-changed is a no-op when no recipe references the changed category", async () => {
      const recipes = [makeRecipe({ uid: "r1" as RecipeUid, categories: ["CAT-A" as CategoryUid] })];
      const mockVs = makeMockVectorStore(10);
      const { infra } = await runIndexBoot(recipes, mockVs);
      mockVs.indexRecipes.mockClear();

      infra.indexEvents.emit({ type: "category-changed", uids: ["CAT-NONE" as CategoryUid] });
      await settle();

      expect(mockVs.indexRecipes).not.toHaveBeenCalled();
    });
  });

  describe("error isolation", () => {
    it("catches and logs an indexRecipes failure, and a later event still indexes", async () => {
      const r1 = makeRecipe({ uid: "r1" as RecipeUid });
      const r2 = makeRecipe({ uid: "r2" as RecipeUid });
      const mockVs = makeMockVectorStore(10);
      const { infra, records } = await runIndexBoot([r1, r2], mockVs);
      mockVs.indexRecipes.mockClear();
      mockVs.indexRecipes
        .mockReturnValueOnce(errAsync(new VectorStoreError("embeddings down")))
        .mockReturnValueOnce(okAsync(undefined));

      infra.indexEvents.emit({ type: "recipe-changed", recipes: [r1] });
      await settle();
      infra.indexEvents.emit({ type: "recipe-changed", recipes: [r2] });
      await settle();

      // The first re-index threw and was logged; the second still ran.
      expect(mockVs.indexRecipes).toHaveBeenCalledTimes(2);
      const errs = reindexErrors(records);
      expect(errs).toHaveLength(1);
      expect(errs[0]!["err"]).toBeDefined();
    });

    it("catches and logs a removeRecipe failure", async () => {
      const mockVs = makeMockVectorStore(10);
      mockVs.removeRecipe.mockReturnValueOnce(errAsync(new VectorStoreError("remove failed")));
      const { infra, records } = await runIndexBoot([], mockVs);

      infra.indexEvents.emit({ type: "recipe-removed", uids: ["uid1" as RecipeUid] });
      await settle();

      expect(reindexErrors(records)).toHaveLength(1);
    });
  });

  describe("startup-reconcile retry", () => {
    it("retries a failed startup reconcile on the next recipe-changed cycle", async () => {
      const recipe = makeRecipe({ uid: "r1" as RecipeUid });
      const mockVs = makeMockVectorStore(10);
      // Embeddings briefly down at boot: the startup reconcile's indexRecipes errs.
      mockVs.indexRecipes.mockReturnValueOnce(errAsync(new VectorStoreError("embeddings down")));

      const { infra } = await runIndexBoot([recipe], mockVs);
      expect(mockVs.indexRecipes).toHaveBeenCalledTimes(1); // the failed startup attempt
      mockVs.indexRecipes.mockClear();

      // A no-change cycle still drains the pending reconcile and re-scans the full store.
      infra.indexEvents.emit({ type: "recipe-changed", recipes: [] });
      await settle();

      expect(mockVs.indexRecipes).toHaveBeenCalledTimes(1);
      expect((mockVs.indexRecipes.mock.calls[0]![0] as ReadonlyArray<Recipe>).map((r) => r.uid)).toEqual(["r1"]);
    });

    it("does not retry once the startup reconcile has succeeded", async () => {
      const recipe = makeRecipe({ uid: "r1" as RecipeUid });
      const mockVs = makeMockVectorStore(10); // startup reconcile succeeds (default resolve)
      const { infra } = await runIndexBoot([recipe], mockVs);
      mockVs.indexRecipes.mockClear();

      infra.indexEvents.emit({ type: "recipe-changed", recipes: [] });
      await settle();

      expect(mockVs.indexRecipes).not.toHaveBeenCalled();
    });
  });

  describe("feature gate", () => {
    it("is a no-op when embeddings are disabled (null vector store)", async () => {
      const { log } = makePinoCapture();
      const infra: Infra = { ...makeKernelInfra({ cacheDir: "/discover-index-boot-test-unused" }), log };
      const discoverModule = registeredModules().find((m) => m.id === "discover")!;
      const built = await discoverModule.build(infra);

      // Features off → the .state factory never builds a vectorStore.
      expect((built.state as { vectorStore: VectorStore | null }).vectorStore).toBeNull();

      // The hook early-returns; with no subscription, emitting a re-index event must not throw.
      await built.onReady!.index!({ state: built.state, deps: { recipe: makeRecipeDeps([]) }, infra });
      expect(() => infra.indexEvents.emit({ type: "recipe-changed", recipes: [] })).not.toThrow();
    });
  });
});
