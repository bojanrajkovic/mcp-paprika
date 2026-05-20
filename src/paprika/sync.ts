import { scheduler } from "node:timers/promises";
import { createRequire } from "node:module";

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
  private _ac: AbortController | null = null;

  constructor(context: AppContext, intervalMs: number) {
    this._context = context;
    this._intervalMs = intervalMs;
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
      SyncEngine._log("Fetching recipe list...");
      const entries = await this._context.client.listRecipes();
      SyncEngine._log(`Got ${entries.length} recipe entries.`);
      const diff = this._context.cache.diffRecipes(entries);
      SyncEngine._log(
        `Recipe diff: ${diff.added.length} added, ${diff.changed.length} changed, ${diff.removed.length} removed.`,
      );

      // Compute UIDs to fetch
      const uidsToFetch = [...diff.added, ...diff.changed];

      // Fetch recipes if any exist
      let fetchedRecipes: Array<Recipe> = [];
      if (uidsToFetch.length > 0) {
        SyncEngine._log(`Fetching ${uidsToFetch.length} recipes...`);
        fetchedRecipes = await this._context.client.getRecipes(uidsToFetch);
        SyncEngine._log(`Fetched ${fetchedRecipes.length} recipes.`);
      }

      // Write fetched recipes to cache and store
      for (const recipe of fetchedRecipes) {
        await this._context.cache.putRecipe(recipe, recipe.hash);
        this._context.store.set(recipe);
      }

      // Remove deleted recipes (async, use Promise.all for concurrency)
      await Promise.all(diff.removed.map((uid) => this._context.cache.removeRecipe(uid)));
      for (const uid of diff.removed) {
        this._context.store.delete(uid as RecipeUid);
      }

      // 2. Category sync path (replace-all)
      SyncEngine._log("Fetching categories...");
      const categories = await this._context.client.listCategories();
      SyncEngine._log(`Got ${categories.length} categories.`);
      this._context.store.setCategories(categories);
      for (const category of categories) {
        await this._context.cache.putCategory(category, category.uid);
      }

      // 3. Pantry sync (replace-all with orphan cleanup)
      SyncEngine._log("Fetching pantry...");
      const pantryItems = await this._context.client.listPantry();
      SyncEngine._log(`Got ${pantryItems.length.toString()} pantry items.`);

      const cachedPantryItems = await this._context.cache.getAllPantryItems();
      const cachedPantryUids = new Set(cachedPantryItems.map((item) => item.uid));
      const incomingPantryUids = new Set(pantryItems.map((item) => item.uid));
      const orphanPantryUids = [...cachedPantryUids].filter((uid) => !incomingPantryUids.has(uid));
      const newPantryUids = [...incomingPantryUids].filter((uid) => !cachedPantryUids.has(uid));
      const cachedPantryByUid = new Map(cachedPantryItems.map((item) => [item.uid, item]));
      // Pantry items have no hash field, so detect content edits to existing UIDs
      // (quantity/notes/in-stock/etc.) by field-wise comparison; without this, MCP
      // clients would see stale resource content until an add or remove triggered
      // a notification.
      const updatedPantryUids = pantryItems.filter((incoming) => {
        const cached = cachedPantryByUid.get(incoming.uid);
        return cached !== undefined && !pantryItemsEqual(cached, incoming);
      });
      const pantryHasChanges = orphanPantryUids.length > 0 || newPantryUids.length > 0 || updatedPantryUids.length > 0;

      await Promise.all(orphanPantryUids.map((uid) => this._context.cache.removePantryItem(uid)));
      this._context.pantryStore.load(pantryItems);
      for (const item of pantryItems) {
        await this._context.cache.putPantryItem(item);
      }

      if (orphanPantryUids.length > 0) {
        SyncEngine._log(`Removed ${orphanPantryUids.length.toString()} orphan pantry items.`);
      }

      // 4. Finalization
      SyncEngine._log("Flushing cache to disk...");
      await this._context.cache.flush();

      // Determine if changes exist
      const hasChanges =
        diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0 || pantryHasChanges;

      // Send resource notification if changes exist
      if (hasChanges) {
        this._context.notifier.resourceListChanged();
      }

      // Partition fetched recipes: added vs updated
      const addedSet = new Set(diff.added);
      const addedRecipes = fetchedRecipes.filter((r) => addedSet.has(r.uid));
      const updatedRecipes = fetchedRecipes.filter((r) => !addedSet.has(r.uid));

      // Build and emit SyncResult
      const result: SyncResult = {
        added: addedRecipes,
        updated: updatedRecipes,
        removedUids: diff.removed,
      };
      this._events.emit("sync:complete", result);

      SyncEngine._log(
        `Sync complete: ${addedRecipes.length} added, ${updatedRecipes.length} updated, ${diff.removed.length} removed.`,
      );

      // Log success via MCP — notifier swallows transport errors internally
      await this._context.notifier.loggingMessage({
        level: "info",
        data: `Sync complete: ${addedRecipes.length} added, ${updatedRecipes.length} updated, ${diff.removed.length} removed`,
      });
    } catch (error: unknown) {
      // Convert caught value to Error
      const err = error instanceof Error ? error : new Error(String(error));

      SyncEngine._log(`Sync failed: ${err.message}`);

      // Log error via MCP — notifier swallows transport errors internally
      await this._context.notifier.loggingMessage({
        level: "error",
        data: `Sync failed: ${err.message}`,
      });

      // Emit error event
      this._events.emit("sync:error", err);
    }
  }

  private static _log(msg: string): void {
    process.stderr.write(`[mcp-paprika:sync] ${msg}\n`);
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
