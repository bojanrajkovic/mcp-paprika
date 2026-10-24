import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Infra } from "../../../kernel/registry.js";
import type { RecipeSyncResult } from "../../../paprika/sync-types.js";
import type { RecipeUid } from "../ids.js";
import type { RecipeState } from "../module.js";
import type { Recipe } from "../types.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useTempDir } from "../../../../test/support/disk-caches.js";
import { makeKernelInfra } from "../../../../test/support/kernel-harness.js";
import { registeredModules } from "../../../kernel/registry.js";
import { PaprikaError } from "../../../paprika/errors.js";
import { PartialSyncError } from "../../../paprika/sync-types.js";
import { recipesSync } from "./recipe-sync.js";
// Side-effect: populate the module registry so the recipe module is resolvable.
import "../../../kernel/modules.generated.js";

/**
 * Drives the recipe domain's bespoke diff-and-fetch reconcile directly — the live
 * home of the #57 pending-write race + the #92 observation-clearing-by-hash. Builds
 * the real recipe module (real `RecipeDiskCache` + `RecipeStore`) against a temp cache dir and
 * a mock client, seeds the store/cache, then runs `recipesSync(state).reconcile(ctx)`.
 */
describe("recipe diff-and-fetch reconcile", () => {
  const tmp = useTempDir("paprika-recipe-sync-");
  let infra: Infra;
  let state: RecipeState;
  const listRecipes = vi.fn();
  const fetchRecipes = vi.fn();

  /**
   * Answer `fetchRecipes` per UID from `recipes`; a UID with no recipe gets a
   * fetch error (a stand-in for a rate-limited request that exhausted its retries).
   */
  function serve(...recipes: ReadonlyArray<Recipe>): void {
    fetchRecipes.mockImplementation((uids: ReadonlyArray<string>) =>
      uids.map((uid) => {
        const recipe = recipes.find((r) => r.uid === uid);
        return recipe === undefined ? errAsync(new PaprikaError(`429 for ${uid}`)) : okAsync(recipe);
      }),
    );
  }

  beforeEach(async () => {
    await tmp.setup();
    listRecipes.mockReset();
    fetchRecipes.mockReset();
    serve();
    infra = makeKernelInfra({ cacheDir: tmp.dir(), client: { listRecipes, fetchRecipes } });
    const recipeModule = registeredModules().find((m) => m.id === "recipe");
    if (recipeModule === undefined) throw new Error("recipe module not registered");
    state = (await recipeModule.build(infra, {})).state as RecipeState;
  });

  afterEach(async () => {
    await tmp.teardown();
  });

  // recipesSync's reconcile always resolves ok with a RecipeSyncResult; the
  // SyncContribution boundary widens it to `Result<AnySyncResult | void, _>`, so
  // unwrap and narrow it back for the assertions.
  const reconcile = async (): Promise<RecipeSyncResult> =>
    (await recipesSync(state).reconcile({ state, deps: {}, infra }))._unsafeUnwrap() as RecipeSyncResult;

  /** Seed a recipe into both the cache (so its hash enters the diff index) and the store. */
  async function seed(recipe: ReturnType<typeof makeRecipe>): Promise<void> {
    await state.recipe.cache.put(recipe);
    state.recipe.store.set(recipe);
  }

  describe("diff-and-fetch happy path", () => {
    it("adds a recipe present in the list but not the cache", async () => {
      const r = makeRecipe({ uid: "r-add" as RecipeUid, name: "Added", hash: "h1" });
      listRecipes.mockReturnValue(okAsync([{ uid: r.uid, hash: r.hash }]));
      serve(r);

      const result = await reconcile();

      expect(fetchRecipes).toHaveBeenCalledWith([r.uid]);
      expect(state.recipe.store.get(r.uid)?.name).toBe("Added");
      expect(result.changes.added.map((x) => x.uid)).toEqual([r.uid]);
    });

    it("re-fetches a recipe whose hash changed", async () => {
      await seed(makeRecipe({ uid: "r-chg" as RecipeUid, name: "Old", hash: "old" }));
      const updated = makeRecipe({ uid: "r-chg" as RecipeUid, name: "New", hash: "new" });
      listRecipes.mockReturnValue(okAsync([{ uid: updated.uid, hash: "new" }]));
      serve(updated);

      const result = await reconcile();

      expect(state.recipe.store.get(updated.uid)?.name).toBe("New");
      expect(result.changes.updated.map((x) => x.uid)).toEqual([updated.uid]);
    });

    it("drops a recipe the server no longer lists", async () => {
      await seed(makeRecipe({ uid: "r-del" as RecipeUid, name: "Gone", hash: "h" }));
      listRecipes.mockReturnValue(okAsync([]));

      const result = await reconcile();

      expect(state.recipe.store.get("r-del" as RecipeUid)).toBeUndefined();
      expect(fetchRecipes).not.toHaveBeenCalled();
      expect(result.changes.removedUids).toEqual(["r-del"]);
    });

    it("skips a recipe whose hash is unchanged (no fetch)", async () => {
      await seed(makeRecipe({ uid: "r-same" as RecipeUid, name: "Same", hash: "h" }));
      listRecipes.mockReturnValue(okAsync([{ uid: "r-same", hash: "h" }]));

      await reconcile();

      expect(fetchRecipes).not.toHaveBeenCalled();
      expect(state.recipe.store.get("r-same" as RecipeUid)?.name).toBe("Same");
    });
  });

  describe("#57 pending-write race", () => {
    it("does NOT remove a pending-upsert when the canonical list is stale (missing it)", async () => {
      const r = makeRecipe({ uid: "r-pend" as RecipeUid, name: "Just Written", hash: "new" });
      await seed(r);
      state.recipe.store.markPendingUpsert(r.uid);
      // Stale list: Paprika hasn't propagated our write, so the UID is absent.
      listRecipes.mockReturnValue(okAsync([]));

      await reconcile();

      // The pending-upsert guard keeps our local copy instead of treating it as an orphan.
      expect(state.recipe.store.get(r.uid)?.name).toBe("Just Written");
    });

    it("does NOT resurrect a pending-delete (trashed) recipe the stale list still carries", async () => {
      const trashed = makeRecipe({ uid: "r-trash" as RecipeUid, name: "Trashed", hash: "post", inTrash: true });
      await seed(trashed);
      state.recipe.store.markPendingDelete(trashed.uid);
      // Stale list still has it with the pre-trash hash → would otherwise diff.changed + re-fetch.
      listRecipes.mockReturnValue(okAsync([{ uid: trashed.uid, hash: "pre" }]));
      serve(makeRecipe({ uid: trashed.uid, name: "Trashed", hash: "pre", inTrash: false }));

      await reconcile();

      expect(fetchRecipes).not.toHaveBeenCalled();
      expect(state.recipe.store.get(trashed.uid)?.inTrash).toBe(true);
    });

    it("clears a pending-upsert only once the canonical hash matches (#92 observation-clearing)", async () => {
      const r = makeRecipe({ uid: "r-clear" as RecipeUid, name: "Edited", hash: "new" });
      await seed(r);
      state.recipe.store.markPendingUpsert(r.uid);

      // Cycle 1: canonical entry still carries the pre-write hash → NOT cleared.
      listRecipes.mockReturnValue(okAsync([{ uid: r.uid, hash: "old" }]));
      await reconcile();
      expect(state.recipe.store.isPendingUpsert(r.uid)).toBe(true);
      expect(state.recipe.store.get(r.uid)?.name).toBe("Edited");

      // Cycle 2: canonical hash now matches our local content → cleared.
      listRecipes.mockReturnValue(okAsync([{ uid: r.uid, hash: "new" }]));
      await reconcile();
      expect(state.recipe.store.isPendingUpsert(r.uid)).toBe(false);
      expect(state.recipe.store.get(r.uid)?.name).toBe("Edited");
    });
  });

  it("marks the store synced after a cycle", async () => {
    listRecipes.mockReturnValue(okAsync([]));
    expect(state.recipe.store.hasSynced).toBe(false);
    await reconcile();
    expect(state.recipe.store.hasSynced).toBe(true);
  });

  describe("#483 partial fetch progress", () => {
    const a = makeRecipe({ uid: "r-a" as RecipeUid, name: "A", hash: "ha" });
    const b = makeRecipe({ uid: "r-b" as RecipeUid, name: "B", hash: "hb" });
    const c = makeRecipe({ uid: "r-c" as RecipeUid, name: "C", hash: "hc" });
    const listAll = (): void => {
      listRecipes.mockReturnValue(okAsync([a, b, c].map((r) => ({ uid: r.uid, hash: r.hash }))));
    };

    it("keeps every recipe that landed when a sibling fetch fails, and flushes them", async () => {
      listAll();
      serve(a, b); // c's fetch fails
      const flush = vi.spyOn(state.recipe.cache, "flush");

      const outcome = await recipesSync(state).reconcile({ state, deps: {}, infra });

      const error = outcome._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(PartialSyncError);
      expect(error).toMatchObject({ landed: 2, failed: 1, cause: { message: "429 for r-c" } });
      expect(state.recipe.store.get(a.uid)?.name).toBe("A");
      expect(state.recipe.store.get(b.uid)?.name).toBe("B");
      expect(state.recipe.store.get(c.uid)).toBeUndefined();
      expect(flush).toHaveBeenCalledOnce();
      expect(state.recipe.store.hasSynced).toBe(false);
    });

    it("emits recipe-changed for the recipes that landed, so discover indexes them", async () => {
      listAll();
      serve(a, b);
      const emit = vi.spyOn(infra.indexEvents, "emit");

      await recipesSync(state).reconcile({ state, deps: {}, infra });

      expect(emit).toHaveBeenCalledWith({ type: "recipe-changed", recipes: [a, b] });
    });

    it("returns the plain fetch error (not partial) when nothing landed", async () => {
      listAll();
      serve(); // every fetch fails
      const flush = vi.spyOn(state.recipe.cache, "flush");

      const outcome = await recipesSync(state).reconcile({ state, deps: {}, infra });

      const error = outcome._unsafeUnwrapErr();
      expect(error).not.toBeInstanceOf(PartialSyncError);
      expect(error).toMatchObject({ message: "429 for r-a" });
      expect(flush).not.toHaveBeenCalled();
    });

    it("resumes on the next cycle, fetching only what's still missing", async () => {
      listAll();
      serve(a, b);
      await recipesSync(state).reconcile({ state, deps: {}, infra });

      fetchRecipes.mockClear();
      serve(a, b, c);
      await reconcile();

      expect(fetchRecipes).toHaveBeenCalledWith([c.uid]);
      expect(state.recipe.store.get(c.uid)?.name).toBe("C");
      expect(state.recipe.store.hasSynced).toBe(true);
    });
  });

  describe("partial cache failure", () => {
    it("mirrors a successfully-put recipe into the store even when a sibling put fails", async () => {
      // cache.put eagerly advances the uid→hash index, so a recipe whose put
      // landed but whose store.set was skipped would read as current to the next
      // diff and never be re-fetched — the store would serve it stale until the
      // recipe next changes server-side. Each store.set must ride ITS OWN put.
      const good = makeRecipe({ uid: "r-good" as RecipeUid, name: "Good", hash: "hg" });
      const bad = makeRecipe({ uid: "r-bad" as RecipeUid, name: "Bad", hash: "hb" });
      listRecipes.mockReturnValue(
        okAsync([
          { uid: good.uid, hash: good.hash },
          { uid: bad.uid, hash: bad.hash },
        ]),
      );
      serve(good, bad);
      const realPut = state.recipe.cache.put.bind(state.recipe.cache);
      vi.spyOn(state.recipe.cache, "put").mockImplementation((recipe) =>
        recipe.uid === bad.uid ? errAsync({ context: "put", message: "disk full", cause: undefined }) : realPut(recipe),
      );

      const outcome = await recipesSync(state).reconcile({ state, deps: {}, infra });

      // The cycle aborts as partial (core err), but the recipe whose put landed is
      // in the store — aligned with its already-advanced hash-index entry — and the
      // failed one is in neither.
      const error = outcome._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(PartialSyncError);
      expect(error).toMatchObject({ landed: 1, failed: 1, cause: { message: "disk full" } });
      expect(state.recipe.store.get(good.uid)?.name).toBe("Good");
      expect(state.recipe.store.get(bad.uid)).toBeUndefined();
    });
  });
});
