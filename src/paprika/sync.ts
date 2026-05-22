import { scheduler } from "node:timers/promises";
import { createRequire } from "node:module";

import type { Logger } from "pino";

import type { AppContext } from "../server/app-context.js";
import type { PantryItem, Recipe, RecipeUid, SyncResult } from "./types.js";

function pantryItemsEqual(a: PantryItem, b: PantryItem): boolean {
  return (
    a.uid === b.uid &&
    a.ingredient === b.ingredient &&
    a.quantity === b.quantity &&
    a.aisle === b.aisle &&
    a.aisleUid === b.aisleUid &&
    a.expirationDate === b.expirationDate &&
    a.hasExpiration === b.hasExpiration &&
    a.inStock === b.inStock &&
    a.purchaseDate === b.purchaseDate &&
    a.locationUid === b.locationUid &&
    a.notes === b.notes &&
    a.deleted === b.deleted
  );
}

type SyncEvents = {
  "sync:complete": SyncResult;
  "sync:error": Error;
};

// Use CommonJS require to work around TypeScript ESM resolution issues with mitt
const require = createRequire(import.meta.url);
const mittFactory: unknown = require("mitt");

type SyncEventEmitter = {
  on<K extends keyof SyncEvents>(event: K, handler: (data: SyncEvents[K]) => void): void;
  off<K extends keyof SyncEvents>(event: K, handler?: (data: SyncEvents[K]) => void): void;
  emit<K extends keyof SyncEvents>(event: K, data: SyncEvents[K]): void;
  all: Map<keyof SyncEvents, Array<(data: SyncEvents[keyof SyncEvents]) => void>>;
};

export class SyncEngine {
  private readonly _context: AppContext;
  private readonly _intervalMs: number;
  private readonly _events: SyncEventEmitter;
  private readonly _eventsView: Pick<SyncEventEmitter, "on" | "off">;
  private readonly log: Logger;
  private _ac: AbortController | null = null;

  constructor(context: AppContext, intervalMs: number) {
    this._context = context;
    this._intervalMs = intervalMs;
    this.log = context.log.child({ component: "sync" });
    // CJS require returns unknown; mitt's default export is a factory function that returns the emitter
    this._events = (mittFactory as CallableFunction)() as SyncEventEmitter;
    this._eventsView = {
      on: this._events.on.bind(this._events),
      off: this._events.off.bind(this._events),
    };
  }

  get events(): Pick<SyncEventEmitter, "on" | "off"> {
    return this._eventsView;
  }

  start(): void {
    if (this._ac !== null) {
      return;
    }
    this._ac = new AbortController();
    void this._loop().catch(() => {});
  }

  stop(): void {
    if (this._ac === null) {
      return;
    }
    this._ac.abort();
    this._ac = null;
  }

  async syncOnce(): Promise<void> {
    try {
      // 1. Recipe sync path
      this.log.debug("fetching recipe list");
      const entries = await this._context.client.listRecipes();
      this.log.debug({ count: entries.length }, "fetched recipe list");
      const diff = this._context.cache.diffRecipes(entries);
      this.log.debug(
        { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length },
        "recipe diff computed",
      );

      // Filter the diff through pending-writes (issue #57). A pending-upsert
      // means we just wrote this UID and the canonical list reflects pre-write
      // state; skip add/change/remove for it so sync doesn't roll back or
      // delete our local copy. A pending-delete means we just trashed this UID
      // and the canonical list may still have it; skip add/change so sync
      // doesn't resurrect our just-deleted recipe. We leave diff.removed
      // alone for pending-deletes: if the server actually no longer lists
      // the UID, honoring the removal is correct.
      const filteredRemoved = diff.removed.filter((uid) => !this._context.store.isPendingUpsert(uid as RecipeUid));
      const filteredAdded = diff.added.filter(
        (uid) =>
          !this._context.store.isPendingUpsert(uid as RecipeUid) &&
          !this._context.store.isPendingDelete(uid as RecipeUid),
      );
      const filteredChanged = diff.changed.filter(
        (uid) =>
          !this._context.store.isPendingUpsert(uid as RecipeUid) &&
          !this._context.store.isPendingDelete(uid as RecipeUid),
      );

      // Compute UIDs to fetch
      const uidsToFetch = [...filteredAdded, ...filteredChanged];

      // Fetch recipes if any exist
      let fetchedRecipes: Array<Recipe> = [];
      if (uidsToFetch.length > 0) {
        this.log.debug({ count: uidsToFetch.length }, "fetching recipes");
        fetchedRecipes = await this._context.client.getRecipes(uidsToFetch);
        this.log.debug({ count: fetchedRecipes.length }, "fetched recipes");
      }

      // Write fetched recipes to cache and store
      for (const recipe of fetchedRecipes) {
        await this._context.cache.putRecipe(recipe, recipe.hash);
        this._context.store.set(recipe);
      }

      // Remove deleted recipes (async, use Promise.all for concurrency)
      await Promise.all(filteredRemoved.map((uid) => this._context.cache.removeRecipe(uid)));
      for (const uid of filteredRemoved) {
        this._context.store.delete(uid as RecipeUid);
      }

      // Observation-based clearing for recipe pending-upserts: clear only when
      // the canonical entry's hash matches our local cache. UID presence alone
      // is insufficient for updates — the UID is already in entries with the
      // PRE-write hash while propagation is in flight, and clearing on UID
      // presence would drop protection on the first sync cycle and let the
      // next cycle re-fetch and overwrite our edit (codex P1, PR #92).
      for (const entry of entries) {
        if (!this._context.store.isPendingUpsert(entry.uid)) continue;
        const local = this._context.store.get(entry.uid);
        if (local !== undefined && local.hash === entry.hash) {
          this._context.store.clearPending(entry.uid);
        }
      }

      // 2. Category sync path (replace-all)
      this.log.debug("fetching categories");
      const categories = await this._context.client.listCategories();
      this.log.debug({ count: categories.length }, "fetched categories");
      this._context.store.setCategories(categories);
      for (const category of categories) {
        await this._context.cache.putCategory(category, category.uid);
      }

      // 3. Pantry sync (replace-all with orphan cleanup)
      this.log.debug("fetching pantry");
      const pantryItems = await this._context.client.listPantry();
      this.log.debug({ count: pantryItems.length }, "fetched pantry");

      const cachedPantryItems = await this._context.cache.getAllPantryItems();

      // Pending-writes filtering (issue #57). For pending-upserts we exclude
      // the UID from the canonical incoming list and pull our local version
      // from cache instead — that protects both directions of the race
      // (incoming has stale content, or incoming is missing our UID
      // entirely). For pending-deletes we exclude the UID from incoming so
      // pantryStore.load() and the cache.putPantryItem loop don't resurrect
      // a just-deleted item. Paprika empirically omits soft-deleted items
      // from listPantry (case B), so we don't observation-clear pending
      // deletes — TTL is the only safe clearing mechanism for that direction.
      const incomingFiltered = pantryItems.filter(
        (item) =>
          !this._context.pantryStore.isPendingDelete(item.uid) && !this._context.pantryStore.isPendingUpsert(item.uid),
      );
      const pendingUpsertedItems = cachedPantryItems.filter((item) =>
        this._context.pantryStore.isPendingUpsert(item.uid),
      );
      const effectivePantry = [...incomingFiltered, ...pendingUpsertedItems];

      const cachedPantryUids = new Set(cachedPantryItems.map((item) => item.uid));
      const effectivePantryUids = new Set(effectivePantry.map((item) => item.uid));
      const orphanPantryUids = [...cachedPantryUids].filter((uid) => !effectivePantryUids.has(uid));
      const newPantryUids = [...effectivePantryUids].filter((uid) => !cachedPantryUids.has(uid));
      const cachedPantryByUid = new Map(cachedPantryItems.map((item) => [item.uid, item]));
      // Pantry items have no hash field, so detect content edits to existing UIDs
      // (quantity/notes/in-stock/etc.) by field-wise comparison; without this, MCP
      // clients would see stale resource content until an add or remove triggered
      // a notification.
      const updatedPantryUids = effectivePantry.filter((incoming) => {
        const cached = cachedPantryByUid.get(incoming.uid);
        return cached !== undefined && !pantryItemsEqual(cached, incoming);
      });
      const pantryHasChanges = orphanPantryUids.length > 0 || newPantryUids.length > 0 || updatedPantryUids.length > 0;

      await Promise.all(orphanPantryUids.map((uid) => this._context.cache.removePantryItem(uid)));
      this._context.pantryStore.load(effectivePantry);
      for (const item of effectivePantry) {
        await this._context.cache.putPantryItem(item);
      }

      // Observation-based clearing for pantry pending-upserts: clear only when
      // the canonical item's content equals our local cached content. UID
      // presence alone is insufficient for updates — the UID is already in
      // listPantry with the PRE-write quantity/notes/in-stock while propagation
      // is in flight, and clearing on UID presence would drop protection on
      // the first sync cycle and let the next cycle reload the stale content
      // (codex P1, PR #92).
      for (const item of pantryItems) {
        if (!this._context.pantryStore.isPendingUpsert(item.uid)) continue;
        const cached = cachedPantryByUid.get(item.uid);
        if (cached !== undefined && pantryItemsEqual(cached, item)) {
          this._context.pantryStore.clearPending(item.uid);
        }
      }

      if (orphanPantryUids.length > 0) {
        this.log.debug({ count: orphanPantryUids.length }, "removed orphan pantry items");
      }

      // 4. Finalization
      this.log.debug("flushing cache to disk");
      await this._context.cache.flush();

      // Sweep expired pending-writes (issue #57 TTL fallback). Pending-deletes
      // rely on this for clearing since Paprika gives no observable signal
      // that our soft-delete propagated.
      const sweptStore = this._context.store.sweepPending();
      const sweptPantry = this._context.pantryStore.sweepPending();
      if (sweptStore > 0 || sweptPantry > 0) {
        this.log.debug({ sweptStore, sweptPantry }, "swept pending writes past TTL");
      }

      // Determine if changes exist
      const hasChanges =
        filteredAdded.length > 0 || filteredChanged.length > 0 || filteredRemoved.length > 0 || pantryHasChanges;

      // Send resource notification if changes exist
      if (hasChanges) {
        this._context.notifier.resourceListChanged();
      }

      // Partition fetched recipes: added vs updated
      const addedSet = new Set(filteredAdded);
      const addedRecipes = fetchedRecipes.filter((r) => addedSet.has(r.uid));
      const updatedRecipes = fetchedRecipes.filter((r) => !addedSet.has(r.uid));

      // Build and emit SyncResult
      const result: SyncResult = {
        added: addedRecipes,
        updated: updatedRecipes,
        removedUids: filteredRemoved,
      };
      this._events.emit("sync:complete", result);

      this.log.info(
        { added: addedRecipes.length, updated: updatedRecipes.length, removed: filteredRemoved.length },
        "sync complete",
      );
    } catch (error: unknown) {
      // Convert caught value to Error
      const err = error instanceof Error ? error : new Error(String(error));

      this.log.error({ err }, "sync failed");

      // Emit error event
      this._events.emit("sync:error", err);
    }
  }

  private async _loop(): Promise<void> {
    const signal = this._ac?.signal;
    if (!signal) return;

    while (true) {
      try {
        await this.syncOnce();
      } catch (error) {
        // Defensive: syncOnce() should never throw (AC6.1), but catch here prevents unhandled rejections if the contract is violated
        this._events.emit("sync:error", error instanceof Error ? error : new Error(String(error)));
      }

      try {
        await scheduler.wait(this._intervalMs, { signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        throw error;
      }
    }
  }
}
