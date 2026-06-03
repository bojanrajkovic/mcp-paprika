import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import type { RecipeUid } from "../ids.js";

import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeStubNotifier, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { PaprikaAPIError } from "../paprika/errors.js";
import { RecipeStore } from "../recipe/store.js";
import { registerRestoreRecipeTool, restoreRecipeInputSchema } from "./recipe-restore.js";

// restore_recipe fetches authoritative trash state via ctx.client.getRecipe (NOT the
// local store, which lags app-side trash actions by a sync cycle). On the HAPPY path it
// flips inTrash:false and commits. On a DECLINE branch (already-active, or a 404) it
// reconciles the local cache+store to the authoritative truth — healing a stale row or
// dropping a phantom — without a Paprika write.

const notFound = (uid: string): PaprikaAPIError => new PaprikaAPIError("Not found", 404, `/api/v2/sync/recipe/${uid}/`);

function makeMocks(getRecipe: ReturnType<typeof vi.fn>, saved?: unknown) {
  const { notifier, resourceListChanged } = makeStubNotifier();
  return {
    getRecipe,
    saveRecipe: vi.fn().mockResolvedValue(saved),
    notifySync: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    notifier,
    resourceListChanged,
  };
}

function ctxWith(m: ReturnType<typeof makeMocks>, store: RecipeStore, server: McpServer) {
  return makeCtx(store, server, {
    client: fromAny({ getRecipe: m.getRecipe, saveRecipe: m.saveRecipe, notifySync: m.notifySync }),
    cache: fromAny({ recipes: { put: m.put, remove: m.remove }, flush: m.flush }),
    notifier: m.notifier,
  });
}

describe("restore_recipe tool", () => {
  it("happy path: restores a trashed recipe (authoritative lookup) and saves inTrash:false", async () => {
    const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
    const m = makeMocks(vi.fn().mockResolvedValue(trashed), { ...trashed, inTrash: false });

    const { server, callTool } = makeTestServer();
    const ctx = seed(ctxWith(m, new RecipeStore(), server), { recipes: [makeRecipe({ name: "Keeper" })] });
    registerRestoreRecipeTool(server, ctx);

    const text = getText(await callTool("restore_recipe", { uid: trashed.uid }));

    expect(m.getRecipe).toHaveBeenCalledWith(trashed.uid);
    expect(text).toContain("Old Soup"); // returns the recipe markdown, not an error
    expect(m.saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ inTrash: false }));
  });

  it("restores a recipe trashed app-side that the local store would miss", async () => {
    // The local store has NO knowledge of this UID (trashed in the app, not yet synced),
    // but the authoritative getRecipe returns it with inTrash:true — so it still restores.
    // The pre-fix local-only lookup would have answered "No recipe found" and refused.
    const appTrashed = makeRecipe({ name: "Trashed In App", inTrash: true });
    const m = makeMocks(vi.fn().mockResolvedValue(appTrashed), { ...appTrashed, inTrash: false });

    const { server, callTool } = makeTestServer();
    const ctx = seed(ctxWith(m, new RecipeStore(), server), { recipes: [makeRecipe({ name: "Keeper" })] });
    registerRestoreRecipeTool(server, ctx);

    const text = getText(await callTool("restore_recipe", { uid: appTrashed.uid }));

    expect(text).toContain("Trashed In App");
    expect(m.saveRecipe).toHaveBeenCalledOnce();
  });

  it("already-active no-op: store already agrees → no cache write, no notification", async () => {
    const live = makeRecipe({ name: "Active Recipe", inTrash: false });
    const m = makeMocks(vi.fn().mockResolvedValue(live));

    const { server, callTool } = makeTestServer();
    const ctx = seed(ctxWith(m, new RecipeStore(), server), { recipes: [live] }); // store already holds it, active
    registerRestoreRecipeTool(server, ctx);

    const text = getText(await callTool("restore_recipe", { uid: live.uid }));

    expect(text).toContain("already in your active library");
    expect(m.saveRecipe).not.toHaveBeenCalled();
    expect(m.put).not.toHaveBeenCalled(); // hash + inTrash match → reconcile is a no-op
    expect(m.resourceListChanged).not.toHaveBeenCalled();
  });

  it("already-active heals a stale local copy that still shows the recipe trashed", async () => {
    // The store lags: it still has the recipe as inTrash:true, but Paprika says it's live
    // (restored in the app). Same hash, so only inTrash differs — reconcile flips local.
    const uid = "recipe-stale" as RecipeUid;
    const staleTrashed = makeRecipe({ uid, name: "Restored Elsewhere", inTrash: true });
    const authoritative = { ...staleTrashed, inTrash: false };
    const m = makeMocks(vi.fn().mockResolvedValue(authoritative));

    const { server, callTool } = makeTestServer();
    const store = new RecipeStore();
    const ctx = seed(ctxWith(m, store, server), { recipes: [staleTrashed] });
    registerRestoreRecipeTool(server, ctx);

    const text = getText(await callTool("restore_recipe", { uid }));

    expect(text).toContain("already in your active library");
    expect(m.saveRecipe).not.toHaveBeenCalled(); // a reconcile, not a Paprika write
    expect(m.put).toHaveBeenCalledWith(expect.objectContaining({ uid, inTrash: false }));
    expect(store.get(uid)?.inTrash).toBe(false); // local store healed to authoritative truth
    expect(m.resourceListChanged).toHaveBeenCalledOnce();
  });

  it("not-found: a 404 with no local copy returns not-found, no removal, no save", async () => {
    const m = makeMocks(vi.fn().mockRejectedValue(notFound("nonexistent-uid")));

    const { server, callTool } = makeTestServer();
    const ctx = seed(ctxWith(m, new RecipeStore(), server), { recipes: [makeRecipe({ name: "Keeper" })] });
    registerRestoreRecipeTool(server, ctx);

    const text = getText(await callTool("restore_recipe", { uid: "nonexistent-uid" }));

    expect(text).toContain('No recipe found with UID "nonexistent-uid".');
    expect(m.saveRecipe).not.toHaveBeenCalled();
    expect(m.remove).not.toHaveBeenCalled(); // nothing stale to drop
  });

  it("404 drops a stale local phantom the store still held", async () => {
    // Purged elsewhere (or never synced as deleted): the store still lists it, but
    // getRecipe 404s. Reconcile removes it so a later read/search can't serve a phantom.
    const uid = "recipe-phantom" as RecipeUid;
    const phantom = makeRecipe({ uid, name: "Ghost" });
    const m = makeMocks(vi.fn().mockRejectedValue(notFound(uid)));

    const { server, callTool } = makeTestServer();
    const store = new RecipeStore();
    const ctx = seed(ctxWith(m, store, server), { recipes: [phantom] });
    registerRestoreRecipeTool(server, ctx);

    const text = getText(await callTool("restore_recipe", { uid }));

    expect(text).toContain("No recipe found");
    expect(m.remove).toHaveBeenCalledWith(uid);
    expect(store.get(uid)).toBeUndefined(); // phantom dropped locally
    expect(m.resourceListChanged).toHaveBeenCalledOnce();
    expect(m.saveRecipe).not.toHaveBeenCalled();
  });

  it("a transient (non-404) lookup error does NOT masquerade as already-active or reconcile", async () => {
    const m = makeMocks(vi.fn().mockRejectedValue(new PaprikaAPIError("Server error", 503, "/api/v2/sync/recipe/x/")));

    const { server, callTool } = makeTestServer();
    const ctx = seed(ctxWith(m, new RecipeStore(), server), { recipes: [makeRecipe({ name: "Keeper" })] });
    registerRestoreRecipeTool(server, ctx);

    const text = getText(await callTool("restore_recipe", { uid: "some-uid" }));

    expect(text.toLowerCase()).toContain("failed to look up");
    expect(text).not.toContain("already in your active library");
    expect(m.saveRecipe).not.toHaveBeenCalled();
    expect(m.put).not.toHaveBeenCalled(); // unknown truth → leave local state untouched
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("cold-start guard: an unsynced store returns the cold-start message without fetching", async () => {
    const m = makeMocks(vi.fn());

    const { server, callTool } = makeTestServer();
    const ctx = ctxWith(m, new RecipeStore(), server); // never load()ed → hasSynced false
    registerRestoreRecipeTool(server, ctx);

    const text = getText(await callTool("restore_recipe", { uid: "any-uid" }));

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(m.getRecipe).not.toHaveBeenCalled();
  });

  it("schema: rejects unknown keys (.strict())", () => {
    expect(restoreRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});
