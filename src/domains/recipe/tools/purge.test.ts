import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeUid } from "../../../ids.js";
import type { RecipeState } from "../module.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { PaprikaAPIError } from "../../../paprika/errors.js";

// purge_recipe fetches authoritative state via client.getRecipe (NOT the local
// store, which can lag app-side trash actions). The store only needs hasSynced so
// the cold-start guard passes; the commit path goes through commitRecipeHardDelete.

const notFound = (uid: string): PaprikaAPIError => new PaprikaAPIError("Not found", 404, `/api/v2/sync/recipe/${uid}/`);

describe("purge_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  describe("permanently deletes a trashed recipe (authoritative lookup)", () => {
    it("trashed recipe hard-deleted with confirmation", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const tombstone = { ...trashed, inTrash: true, deleted: true };
      vi.mocked(kh.client().getRecipe).mockResolvedValue(trashed);
      vi.mocked(kh.client().saveRecipe).mockResolvedValue(tombstone);
      kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

      const result = await kh.callTool("purge_recipe", { uid: trashed.uid });
      const text = getText(result);

      expect(kh.client().getRecipe).toHaveBeenCalledWith(trashed.uid);
      expect(text).toContain("Old Soup");
      expect(text.toLowerCase()).toContain("permanently deleted");
    });

    it("saveRecipe sent with both in_trash and deleted true", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      vi.mocked(kh.client().getRecipe).mockResolvedValue(trashed);
      vi.mocked(kh.client().saveRecipe).mockResolvedValue({ ...trashed, inTrash: true, deleted: true });
      kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

      await kh.callTool("purge_recipe", { uid: trashed.uid });

      expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]).toMatchObject({ inTrash: true, deleted: true });
      expect(kh.client().notifySync).toHaveBeenCalledOnce();
    });

    it("commit removes recipe from store and notifies clients (Content entity)", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      vi.mocked(kh.client().getRecipe).mockResolvedValue(trashed);
      vi.mocked(kh.client().saveRecipe).mockResolvedValue({ ...trashed, inTrash: true, deleted: true });
      kh.seed({ recipes: [makeRecipe({ name: "Keeper" }), trashed] }); // flips hasSynced, seeds trashed recipe

      await kh.callTool("purge_recipe", { uid: trashed.uid });

      // Real store assertion — recipe hard-deleted from the kernel store.
      expect((kh.state() as RecipeState).recipe.store.get(trashed.uid)).toBeUndefined();
      expect(kh.resourceListChanged()).toHaveBeenCalled();
    });

    it("deletes a recipe trashed app-side that the local store would miss", async () => {
      // The local store has NO knowledge of this UID (trashed in the app, not yet
      // synced), but the authoritative getRecipe returns it with inTrash:true —
      // so it still deletes.
      const appTrashed = makeRecipe({ name: "Trashed In App", inTrash: true });
      vi.mocked(kh.client().getRecipe).mockResolvedValue(appTrashed);
      vi.mocked(kh.client().saveRecipe).mockResolvedValue({ ...appTrashed, inTrash: true, deleted: true });
      kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced; appTrashed NOT in store

      const result = await kh.callTool("purge_recipe", { uid: appTrashed.uid });

      expect(getText(result).toLowerCase()).toContain("permanently deleted");
      expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    });
  });

  describe("guards against destroying live recipes", () => {
    it("a live (non-trashed) recipe is refused with a trash_recipe-first hint", async () => {
      const live = makeRecipe({ name: "Dinner Tonight", inTrash: false });
      vi.mocked(kh.client().getRecipe).mockResolvedValue(live);
      kh.seed({ recipes: [live] }); // store agrees it's live

      const result = await kh.callTool("purge_recipe", { uid: live.uid });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("not in the trash");
      expect(text).toContain("trash_recipe");
      expect(kh.client().saveRecipe).not.toHaveBeenCalled();
    });

    it("404 from getRecipe returns a not-found / already-deleted message", async () => {
      vi.mocked(kh.client().getRecipe).mockRejectedValue(notFound("nonexistent-uid"));
      kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

      const result = await kh.callTool("purge_recipe", { uid: "nonexistent-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("no recipe found");
      expect(kh.client().saveRecipe).not.toHaveBeenCalled();
    });

    it("idempotent — a second purge_recipe on the same UID reports already-deleted", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      // First lookup returns the trashed recipe; after it's purged, the second lookup 404s.
      vi.mocked(kh.client().getRecipe).mockResolvedValueOnce(trashed).mockRejectedValueOnce(notFound(trashed.uid));
      vi.mocked(kh.client().saveRecipe).mockResolvedValue({ ...trashed, inTrash: true, deleted: true });
      kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

      await kh.callTool("purge_recipe", { uid: trashed.uid }); // first: purges
      const second = await kh.callTool("purge_recipe", { uid: trashed.uid }); // second: already gone

      expect(getText(second).toLowerCase()).toContain("no recipe found");
      expect(kh.client().saveRecipe).toHaveBeenCalledOnce(); // not POSTed again
    });
  });

  describe("failure handling", () => {
    it("saveRecipe throws — error surfaced, no false 'deleted'", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      vi.mocked(kh.client().getRecipe).mockResolvedValue(trashed);
      vi.mocked(kh.client().saveRecipe).mockRejectedValue(new Error("API timeout"));
      kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

      const result = await kh.callTool("purge_recipe", { uid: trashed.uid });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("failed to permanently delete");
      expect(text).toContain("API timeout");
      // The recipe is NOT removed from the store on failure.
      // (trashed was not in the seeded store anyway, but the guard still holds.)
    });

    it("a transient (non-404) lookup error does NOT masquerade as already-deleted", async () => {
      vi.mocked(kh.client().getRecipe).mockRejectedValue(
        new PaprikaAPIError("Server error", 503, "/api/v2/sync/recipe/x/"),
      );
      kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

      const result = await kh.callTool("purge_recipe", { uid: "some-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("failed to look up");
      expect(text.toLowerCase()).not.toContain("permanently deleted");
      expect(kh.client().saveRecipe).not.toHaveBeenCalled();
    });
  });

  describe("cold-start guard", () => {
    it("store not yet synced returns the cold-start message without fetching", async () => {
      // store never seeded — hasSynced false
      const result = await kh.callTool("purge_recipe", { uid: "any-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("not yet synced");
      expect(kh.client().getRecipe).not.toHaveBeenCalled();
    });
  });

  describe("read-path reconcile to authoritative state (canonical pull)", () => {
    it("not-in-trash heals a stale local copy still marked trashed", async () => {
      // The store lags: it holds the recipe as inTrash:true, but Paprika says it's live
      // (restored in the app). purge refuses (it's not trashed) AND aligns local to the
      // authoritative truth — same hash, only inTrash differs — without a Paprika write.
      const uid = "recipe-stale-purge" as RecipeUid;
      const staleTrashed = makeRecipe({ uid, name: "Live Again", inTrash: true });
      const authoritative = { ...staleTrashed, inTrash: false };

      vi.mocked(kh.client().getRecipe).mockResolvedValue(authoritative);
      kh.seed({ recipes: [staleTrashed] }); // seed the stale trashed copy

      const text = await kh.callToolText("purge_recipe", { uid });

      expect(text.toLowerCase()).toContain("not in the trash");
      expect(kh.client().saveRecipe).not.toHaveBeenCalled(); // a reconcile, not a Paprika write
      // Local store healed to authoritative truth.
      expect((kh.state() as RecipeState).recipe.store.get(uid)?.inTrash).toBe(false);
      expect(kh.resourceListChanged()).toHaveBeenCalled();
    });

    it("404 drops a stale local phantom the store still held", async () => {
      // Purged elsewhere (or never synced as deleted): the store still lists it, but
      // getRecipe 404s. Reconcile removes it so a later read/search can't serve a phantom.
      const uid = "recipe-phantom-purge" as RecipeUid;
      const phantom = makeRecipe({ uid, name: "Ghost" });

      vi.mocked(kh.client().getRecipe).mockRejectedValue(notFound(uid));
      kh.seed({ recipes: [phantom] }); // seed the phantom

      const text = await kh.callToolText("purge_recipe", { uid });

      expect(text.toLowerCase()).toContain("no recipe found");
      expect((kh.state() as RecipeState).recipe.store.get(uid)).toBeUndefined(); // phantom dropped locally
      expect(kh.resourceListChanged()).toHaveBeenCalled();
      expect(kh.client().saveRecipe).not.toHaveBeenCalled();
    });
  });
});
