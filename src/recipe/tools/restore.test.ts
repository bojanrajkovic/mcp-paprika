import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeUid } from "../../ids.js";
import type { RecipeSelf } from "../module.js";

import { makeRecipe } from "../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";
import { getText } from "../../../test/support/tool-test-utils.js";
import { PaprikaAPIError } from "../../paprika/errors.js";
import { restoreRecipeInputSchema } from "./restore.js";

// restore_recipe fetches authoritative trash state via client.getRecipe (NOT the
// local store, which lags app-side trash actions by a sync cycle). On the happy path
// it flips inTrash:false and commits. On a DECLINE branch (already-active, or a 404)
// it reconciles the local cache+store to the authoritative truth — healing a stale
// row or dropping a phantom — without a Paprika write.

const notFound = (uid: string): PaprikaAPIError => new PaprikaAPIError("Not found", 404, `/api/v2/sync/recipe/${uid}/`);

describe("restore_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("happy path: restores a trashed recipe and saves inTrash:false", async () => {
    const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
    vi.mocked(kh.client().getRecipe).mockResolvedValue(trashed);
    vi.mocked(kh.client().saveRecipe).mockResolvedValue({ ...trashed, inTrash: false });
    kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

    const text = getText(await kh.callTool("restore_recipe", { uid: trashed.uid }));

    expect(kh.client().getRecipe).toHaveBeenCalledWith(trashed.uid);
    expect(text).toContain("Old Soup");
    expect(kh.client().saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ inTrash: false }));
  });

  it("restores a recipe trashed app-side that the local store would miss", async () => {
    // The local store has NO knowledge of this UID (trashed in the app, not yet synced),
    // but the authoritative getRecipe returns it with inTrash:true — so it still restores.
    const appTrashed = makeRecipe({ name: "Trashed In App", inTrash: true });
    vi.mocked(kh.client().getRecipe).mockResolvedValue(appTrashed);
    vi.mocked(kh.client().saveRecipe).mockResolvedValue({ ...appTrashed, inTrash: false });
    kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced; appTrashed NOT in store

    const text = getText(await kh.callTool("restore_recipe", { uid: appTrashed.uid }));

    expect(text).toContain("Trashed In App");
    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
  });

  it("already-active no-op: local store already agrees, no save, no notification", async () => {
    const live = makeRecipe({ name: "Active Recipe", inTrash: false });
    vi.mocked(kh.client().getRecipe).mockResolvedValue(live);
    kh.seed({ recipes: [live] }); // store holds it as active — exact match, reconcile is a no-op

    const text = getText(await kh.callTool("restore_recipe", { uid: live.uid }));

    expect(text).toContain("already in your active library");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
    // hash + inTrash match the local store → reconcile is a no-op → no notification
    expect(kh.resourceListChanged()).not.toHaveBeenCalled();
  });

  it("already-active heals a stale local copy that still shows the recipe trashed", async () => {
    // The store lags: it still has the recipe as inTrash:true, but Paprika says it's live
    // (restored in the app). Same hash, so only inTrash differs — reconcile flips local.
    const uid = "recipe-stale" as RecipeUid;
    const staleTrashed = makeRecipe({ uid, name: "Restored Elsewhere", inTrash: true });
    const authoritative = { ...staleTrashed, inTrash: false };
    vi.mocked(kh.client().getRecipe).mockResolvedValue(authoritative);
    kh.seed({ recipes: [staleTrashed] }); // seed the stale copy

    const text = getText(await kh.callTool("restore_recipe", { uid }));

    expect(text).toContain("already in your active library");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled(); // a reconcile, not a Paprika write
    // Local store healed to authoritative truth.
    expect((kh.self() as RecipeSelf).recipe.store.get(uid)?.inTrash).toBe(false);
    expect(kh.resourceListChanged()).toHaveBeenCalledOnce();
  });

  it("not-found: a 404 with no local copy returns not-found, no save", async () => {
    vi.mocked(kh.client().getRecipe).mockRejectedValue(notFound("nonexistent-uid"));
    kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

    const text = getText(await kh.callTool("restore_recipe", { uid: "nonexistent-uid" }));

    expect(text).toContain('No recipe found with UID "nonexistent-uid".');
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("404 drops a stale local phantom the store still held", async () => {
    // Purged elsewhere: the store still lists it, but getRecipe 404s.
    // Reconcile removes it so a later read/search can't serve a phantom.
    const uid = "recipe-phantom" as RecipeUid;
    const phantom = makeRecipe({ uid, name: "Ghost" });
    vi.mocked(kh.client().getRecipe).mockRejectedValue(notFound(uid));
    kh.seed({ recipes: [phantom] }); // seed the phantom

    const text = getText(await kh.callTool("restore_recipe", { uid }));

    expect(text).toContain("No recipe found");
    expect((kh.self() as RecipeSelf).recipe.store.get(uid)).toBeUndefined(); // phantom dropped
    expect(kh.resourceListChanged()).toHaveBeenCalledOnce();
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("a transient (non-404) lookup error does NOT masquerade as already-active or reconcile", async () => {
    vi.mocked(kh.client().getRecipe).mockRejectedValue(
      new PaprikaAPIError("Server error", 503, "/api/v2/sync/recipe/x/"),
    );
    kh.seed({ recipes: [makeRecipe({ name: "Keeper" })] }); // flips hasSynced

    const text = getText(await kh.callTool("restore_recipe", { uid: "some-uid" }));

    expect(text.toLowerCase()).toContain("failed to look up");
    expect(text).not.toContain("already in your active library");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
    // unknown truth — leave local state untouched
    expect(kh.resourceListChanged()).not.toHaveBeenCalled();
  });

  it("cold-start guard: an unsynced store returns the cold-start message without fetching", async () => {
    // store never seeded — hasSynced false
    const text = getText(await kh.callTool("restore_recipe", { uid: "any-uid" }));

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().getRecipe).not.toHaveBeenCalled();
  });

  it("schema: rejects unknown keys (.strict())", () => {
    expect(restoreRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});
