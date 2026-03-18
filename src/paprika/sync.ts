import { scheduler } from "node:timers/promises";
import { createRequire } from "node:module";

import type { ServerContext } from "../types/server-context.js";
import type { Recipe, RecipeUid, SyncResult } from "./types.js";

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
  private readonly _context: ServerContext;
  private readonly _intervalMs: number;
  private readonly _events: SyncEventEmitter;
  private readonly _eventsView: Pick<SyncEventEmitter, "on" | "off">;
  private _ac: AbortController | null = null;

  constructor(context: ServerContext, intervalMs: number) {
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
      const entries = await this._context.client.listRecipes();
      const diff = this._context.cache.diffRecipes(entries);

      // Compute UIDs to fetch
      const uidsToFetch = [...diff.added, ...diff.changed];

      // Fetch recipes if any exist
      let fetchedRecipes: Array<Recipe> = [];
      if (uidsToFetch.length > 0) {
        fetchedRecipes = await this._context.client.getRecipes(uidsToFetch);
      }

      // Write fetched recipes to cache and store
      for (const recipe of fetchedRecipes) {
        this._context.cache.putRecipe(recipe, recipe.hash);
        this._context.store.set(recipe);
      }

      // Remove deleted recipes (async, use Promise.all for concurrency)
      await Promise.all(diff.removed.map((uid) => this._context.cache.removeRecipe(uid)));
      for (const uid of diff.removed) {
        this._context.store.delete(uid as RecipeUid);
      }

      // 2. Category sync path (replace-all)
      const categories = await this._context.client.listCategories();
      this._context.store.setCategories(categories);
      for (const category of categories) {
        this._context.cache.putCategory(category, category.uid);
      }

      // 3. Finalization
      await this._context.cache.flush();

      // Determine if recipe changes exist
      const hasChanges = diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0;

      // Send resource notification if changes exist
      if (hasChanges) {
        this._context.server.sendResourceListChanged();
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

      // Log success
      try {
        await this._context.server.sendLoggingMessage({
          level: "info",
          data: `Sync complete: ${addedRecipes.length} added, ${updatedRecipes.length} updated, ${diff.removed.length} removed`,
        });
      } catch {
        // Logging may throw if not connected — swallow silently
      }
    } catch (error: unknown) {
      // Convert caught value to Error
      const err = error instanceof Error ? error : new Error(String(error));

      // Log error
      try {
        await this._context.server.sendLoggingMessage({
          level: "error",
          data: `Sync failed: ${err.message}`,
        });
      } catch {
        // Logging may throw if not connected — swallow silently
      }

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
