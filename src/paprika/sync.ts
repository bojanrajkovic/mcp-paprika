import { scheduler } from "node:timers/promises";
import { createRequire } from "node:module";

import type { Logger } from "pino";

import type { DiskCache } from "../cache/disk/base.js";
import type { TombstoneEntityStore } from "../entity/tombstone-store.js";
import type { AppContext } from "../server/app-context.js";
import type {
  AnySyncResult,
  Category,
  EntityChanges,
  GroceryItem,
  GroceryItemSyncResult,
  GroceryList,
  GroceryListSyncResult,
  Meal,
  Menu,
  MenuItem,
  MenuSyncResult,
  MenuItemSyncResult,
  PantryItem,
  Photo,
  Recipe,
  RecipeUid,
  RecipeSyncResult,
  PantrySyncResult,
} from "./types.js";

function categoriesEqual(a: Category, b: Category): boolean {
  return a.uid === b.uid && a.name === b.name && a.orderFlag === b.orderFlag && a.parentUid === b.parentUid;
}

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
    a.notes === b.notes &&
    a.deleted === b.deleted
  );
}

function groceryListsEqual(a: GroceryList, b: GroceryList): boolean {
  return (
    a.uid === b.uid &&
    a.name === b.name &&
    a.orderFlag === b.orderFlag &&
    a.isDefault === b.isDefault &&
    a.remindersList === b.remindersList &&
    a.deleted === b.deleted
  );
}

function mealsEqual(a: Meal, b: Meal): boolean {
  return (
    a.uid === b.uid &&
    a.recipeUid === b.recipeUid &&
    a.name === b.name &&
    a.date === b.date &&
    a.type === b.type &&
    a.typeUid === b.typeUid &&
    a.orderFlag === b.orderFlag &&
    a.isIngredient === b.isIngredient &&
    a.scale === b.scale &&
    a.deleted === b.deleted
  );
}

function menusEqual(a: Menu, b: Menu): boolean {
  return (
    a.uid === b.uid &&
    a.name === b.name &&
    a.days === b.days &&
    a.orderFlag === b.orderFlag &&
    a.notes === b.notes &&
    a.deleted === b.deleted
  );
}

function menuItemsEqual(a: MenuItem, b: MenuItem): boolean {
  return (
    a.uid === b.uid &&
    a.menuUid === b.menuUid &&
    a.recipeUid === b.recipeUid &&
    a.name === b.name &&
    a.day === b.day &&
    a.typeUid === b.typeUid &&
    a.orderFlag === b.orderFlag &&
    a.deleted === b.deleted
  );
}

function photosEqual(a: Photo, b: Photo): boolean {
  return (
    a.uid === b.uid &&
    a.recipeUid === b.recipeUid &&
    a.filename === b.filename &&
    a.name === b.name &&
    a.orderFlag === b.orderFlag &&
    a.hash === b.hash &&
    a.deleted === b.deleted
  );
}

function groceryItemsEqual(a: GroceryItem, b: GroceryItem): boolean {
  return (
    a.uid === b.uid &&
    a.name === b.name &&
    a.ingredient === b.ingredient &&
    a.aisle === b.aisle &&
    a.aisleUid === b.aisleUid &&
    a.listUid === b.listUid &&
    a.purchased === b.purchased &&
    a.deleted === b.deleted &&
    a.orderFlag === b.orderFlag &&
    a.quantity === b.quantity &&
    a.instruction === b.instruction &&
    a.recipe === b.recipe &&
    a.separate === b.separate
  );
}

type ReplaceAllEntityOptions<T extends { uid: UID }, UID extends string> = {
  readonly fetch: () => Promise<ReadonlyArray<T>>;
  readonly cache: Pick<DiskCache<T>, "getAll" | "put" | "remove">;
  readonly store: TombstoneEntityStore<T, UID>;
  readonly equals: (a: T, b: T) => boolean;
  readonly label: string;
  readonly log: Logger;
  readonly afterLoad?: () => void;
};

export async function syncReplaceAllEntity<T extends { uid: UID }, UID extends string>(
  opts: ReplaceAllEntityOptions<T, UID>,
): Promise<EntityChanges<T>> {
  const rawIncoming = await opts.fetch();
  const cached = await opts.cache.getAll();
  const cachedByUid = new Map<UID, T>(cached.map((item) => [item.uid, item]));
  const cachedUids = new Set<UID>(cached.map((item) => item.uid));

  const incomingFiltered = rawIncoming.filter(
    (item) => !opts.store.isPendingDelete(item.uid) && !opts.store.isPendingUpsert(item.uid),
  );
  const pendingUpserted = cached.filter((item) => opts.store.isPendingUpsert(item.uid));
  const effective = [...incomingFiltered, ...pendingUpserted];
  const effectiveUids = new Set<UID>(effective.map((item) => item.uid));

  const orphanUids = [...cachedUids].filter((uid) => !effectiveUids.has(uid));
  const newUids = new Set<UID>([...effectiveUids].filter((uid) => !cachedUids.has(uid)));

  const updated = effective.filter((incoming) => {
    const cachedItem = cachedByUid.get(incoming.uid);
    return cachedItem !== undefined && !opts.equals(cachedItem, incoming);
  });
  const added = effective.filter((item) => newUids.has(item.uid));

  await Promise.all(orphanUids.map((uid) => opts.cache.remove(uid)));
  opts.store.load(effective);
  opts.afterLoad?.();
  await Promise.all(effective.map((item) => opts.cache.put(item)));

  // Observation-based clearing: walk rawIncoming (not effective) so pending-upsert
  // UIDs that were spliced out still get checked against the snapshot.
  for (const item of rawIncoming) {
    if (!opts.store.isPendingUpsert(item.uid)) continue;
    const cachedItem = cachedByUid.get(item.uid);
    if (cachedItem !== undefined && opts.equals(cachedItem, item)) {
      opts.store.clearPending(item.uid);
    }
  }

  if (orphanUids.length > 0) {
    opts.log.debug({ count: orphanUids.length }, `removed orphan ${opts.label}`);
  }

  return { added, updated, removedUids: orphanUids };
}

type SyncEvents = {
  "sync:complete": AnySyncResult;
  "sync:error": Error;
  // Category catalog changed (name edits / deletes pulled from the server).
  // Separate from the resource-oriented `sync:complete` union because
  // categories have no MCP resource surface — this event exists only so the
  // discover feature can re-embed recipes whose embedding text bakes in a
  // category's display name. Carries the same change set the category sync
  // already computes; the subscriber re-indexes recipes referencing any
  // `updated` or `removed` category UID.
  "sync:category-change": EntityChanges<Category>;
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
      const diff = this._context.cache.recipes.diff(entries);
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
        await this._context.cache.recipes.put(recipe);
        this._context.store.set(recipe);
      }

      // Remove deleted recipes (async, use Promise.all for concurrency)
      await Promise.all(filteredRemoved.map((uid) => this._context.cache.recipes.remove(uid)));
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

      // Recipe sync is complete; mark the store as synced now so recipe tools
      // remain available even if category or pantry sync subsequently fails.
      this._context.store.markSynced();
      this._context.store.setLastSyncedAt();

      // 2. Category sync (replace-all with pending-write filtering)
      // Categories gained create/update/delete write tools (#108), so they need
      // the same pending-write protection as pantry/grocery — a just-deleted
      // category must not be resurrected by an in-flight snapshot. No
      // sync:complete event: categories are a reference entity with no MCP
      // resource surface (recipe rendering resolves category names on read).
      const categoryChanges = await syncReplaceAllEntity({
        fetch: () => this._context.client.listCategories(),
        cache: this._context.cache.categories,
        store: this._context.categoryStore,
        equals: categoriesEqual,
        label: "categories",
        log: this.log,
      });
      // Re-embed recipes when a category's display name moved (rename) or the
      // category went away (its name token must drop from referencing recipes).
      // `added` is excluded: a brand-new category has no referencing recipes yet
      // — those arrive via update_recipe, which re-embeds through recipe sync.
      // `updated` may also carry re-parents/order changes, but the discover
      // handler relies on the vector store's content-hash skip to make those a
      // no-op rather than filtering name changes here (it lacks the old name).
      if (categoryChanges.updated.length > 0 || categoryChanges.removedUids.length > 0) {
        this._events.emit("sync:category-change", categoryChanges);
      }

      // 2.5. Aisle sync (replace-all with pending-write filtering)
      // Aisles sync before pantry so aisle data is available for resolution
      // when ensureAisle is called from pantry write tools.
      this.log.debug("fetching aisles");
      const aisles = await this._context.client.listAisles();
      this.log.debug({ count: aisles.length }, "fetched aisles");
      const cachedAisles = await this._context.cache.aisles.getAll();

      const incomingAislesFiltered = aisles.filter(
        (a) => !a.deleted && !this._context.aisleStore.isPendingUpsert(a.uid),
      );
      const pendingUpsertedAisles = cachedAisles.filter((a) => this._context.aisleStore.isPendingUpsert(a.uid));
      const effectiveAisles = [...incomingAislesFiltered, ...pendingUpsertedAisles];

      const cachedAisleUids = new Set(cachedAisles.map((a) => a.uid));
      const effectiveAisleUids = new Set(effectiveAisles.map((a) => a.uid));
      const orphanAisleUids = [...cachedAisleUids].filter((uid) => !effectiveAisleUids.has(uid));
      await Promise.all(orphanAisleUids.map((uid) => this._context.cache.aisles.remove(uid)));

      this._context.aisleStore.load(effectiveAisles);
      await Promise.all(effectiveAisles.map((a) => this._context.cache.aisles.put(a)));

      // Observation-based clearing: if a pending-upsert UID appears in the
      // canonical list, the server confirmed the write — clear immediately
      // rather than waiting for TTL, so subsequent syncs pick up server changes.
      for (const aisle of aisles) {
        if (this._context.aisleStore.isPendingUpsert(aisle.uid)) {
          this._context.aisleStore.clearPending(aisle.uid);
        }
      }

      // 3. Pantry sync (replace-all with orphan cleanup)
      this.log.debug("fetching pantry");
      const pantryChanges = await syncReplaceAllEntity({
        fetch: () => this._context.client.listPantry(),
        cache: this._context.cache.pantry,
        store: this._context.pantryStore,
        equals: pantryItemsEqual,
        label: "pantry items",
        log: this.log,
      });

      // 4. Grocery list sync (replace-all with orphan cleanup)
      this.log.debug("fetching grocery lists");
      const groceryListChanges = await syncReplaceAllEntity({
        fetch: () => this._context.client.listGroceryLists(),
        cache: this._context.cache.groceryLists,
        store: this._context.groceryListStore,
        equals: groceryListsEqual,
        label: "grocery lists",
        log: this.log,
        afterLoad: () => this._context.groceryListStore.setLastSyncedAt(),
      });

      // 5. Grocery item sync (replace-all with orphan cleanup)
      this.log.debug("fetching grocery items");
      const groceryItemChanges = await syncReplaceAllEntity({
        fetch: () => this._context.client.listGroceryItems(),
        cache: this._context.cache.groceryItems,
        store: this._context.groceryItemStore,
        equals: groceryItemsEqual,
        label: "grocery items",
        log: this.log,
      });

      // 6. Ingredient catalog sync (replace-all, no pending-writes)
      this.log.debug("fetching grocery ingredients");
      const groceryIngredients = await this._context.client.listGroceryIngredients();
      this.log.debug({ count: groceryIngredients.length }, "fetched grocery ingredients");

      // Drop deleted entries AND entries with no aisle. Paprika returns
      // aisle_uid: null for an ingredient that was never filed into an aisle
      // (GroceryIngredientSchema coerces that to ""). Such a row carries no aisle
      // memory — add_grocery_items resolves it to "" and the item then defaults to
      // "Miscellaneous", identical to having no catalog entry at all — so keeping it
      // just bloats the catalog. (Historically the null value also aborted the whole
      // sync cycle before meals/menus could sync.) Warn on the dropped count so the
      // drop is observable rather than silent.
      const liveIngredients = groceryIngredients.filter((i) => !i.deleted);
      const filteredIngredients = liveIngredients.filter((i) => i.aisleUid !== "");
      const droppedNoAisle = liveIngredients.length - filteredIngredients.length;
      if (droppedNoAisle > 0) {
        this.log.warn({ count: droppedNoAisle }, "dropped grocery ingredients with no aisle");
      }

      const cachedIngredients = await this._context.cache.groceryIngredients.getAll();
      const cachedIngredientUids = new Set(cachedIngredients.map((i) => i.uid));
      const filteredIngredientUids = new Set(filteredIngredients.map((i) => i.uid));
      const orphanIngredientUids = [...cachedIngredientUids].filter((uid) => !filteredIngredientUids.has(uid));

      await Promise.all(orphanIngredientUids.map((uid) => this._context.cache.groceryIngredients.remove(uid)));
      this._context.groceryIngredientStore.load(filteredIngredients);
      await Promise.all(filteredIngredients.map((i) => this._context.cache.groceryIngredients.put(i)));

      if (orphanIngredientUids.length > 0) {
        this.log.debug({ count: orphanIngredientUids.length }, "removed orphan grocery ingredients");
      }

      // 7+8. Meal type + meal sync (best-effort). Isolated in their own try
      // block so a meal-side failure (network blip, schema regression on the
      // /mealtypes/ or /meals/ endpoint) cannot abort the rest of the cycle
      // and leave already-fetched recipe/grocery store mutations unflushed.
      // The meal-history read surface is strictly additive — degrading it to
      // stale data for one cycle is preferable to regressing core sync.
      try {
        // 7. MealType sync (replace-all, no pending-writes — reference catalog like aisles).
        // Filter `deleted: true` like aisles do: GET responses normally omit
        // deleted items, but POSTs use `deleted: true` for soft-deletes (see
        // mealtypes.har.json) so the field is on the schema, and any tombstone
        // that does reach the wire must not be loaded as an active mealtype.
        this.log.debug("fetching meal types");
        const mealTypesRaw = await this._context.client.listMealTypes();
        const mealTypes = mealTypesRaw.filter((mt) => !mt.deleted);
        this.log.debug(
          { count: mealTypes.length, filtered: mealTypesRaw.length - mealTypes.length },
          "fetched meal types",
        );

        const cachedMealTypes = await this._context.cache.mealTypes.getAll();
        const cachedMealTypeUids = new Set(cachedMealTypes.map((mt) => mt.uid));
        const incomingMealTypeUids = new Set(mealTypes.map((mt) => mt.uid));
        const orphanMealTypeUids = [...cachedMealTypeUids].filter((uid) => !incomingMealTypeUids.has(uid));
        await Promise.all(orphanMealTypeUids.map((uid) => this._context.cache.mealTypes.remove(uid)));

        this._context.mealTypeStore.load(mealTypes);
        await Promise.all(mealTypes.map((mt) => this._context.cache.mealTypes.put(mt)));

        if (orphanMealTypeUids.length > 0) {
          this.log.debug({ count: orphanMealTypeUids.length }, "removed orphan meal types");
        }

        // 8. Meal sync (replace-all with orphan cleanup, pending-writes filtered)
        this.log.debug("fetching meals");
        await syncReplaceAllEntity({
          fetch: () => this._context.client.listMeals(),
          cache: this._context.cache.meals,
          store: this._context.mealStore,
          equals: mealsEqual,
          label: "meals",
          log: this.log,
        });
      } catch (mealError: unknown) {
        const err = mealError instanceof Error ? mealError : new Error(String(mealError));
        this.log.warn({ err }, "meal sync failed; core sync will continue");
      }

      // 9+10. Menu + menu-item sync (best-effort). Isolated in their own try
      // block so a menu-side failure cannot abort the rest of the cycle. The
      // menu read/write surface is strictly additive — degrading it to stale
      // data for one cycle is preferable to regressing core sync. Changes
      // default to empty so the sync:complete emissions below are well-formed
      // even when this block throws.
      let menuChanges: EntityChanges<Menu> = { added: [], updated: [], removedUids: [] };
      let menuItemChanges: EntityChanges<MenuItem> = { added: [], updated: [], removedUids: [] };
      try {
        // 9. Menu sync (replace-all with orphan cleanup, pending-writes filtered)
        this.log.debug("fetching menus");
        menuChanges = await syncReplaceAllEntity({
          fetch: () => this._context.client.listMenus(),
          cache: this._context.cache.menus,
          store: this._context.menuStore,
          equals: menusEqual,
          label: "menus",
          log: this.log,
          afterLoad: () => this._context.menuStore.setLastSyncedAt(),
        });

        // 10. Menu-item sync (replace-all with orphan cleanup, pending-writes filtered)
        this.log.debug("fetching menu items");
        menuItemChanges = await syncReplaceAllEntity({
          fetch: () => this._context.client.listMenuItems(),
          cache: this._context.cache.menuItems,
          store: this._context.menuItemStore,
          equals: menuItemsEqual,
          label: "menu items",
          log: this.log,
        });
      } catch (menuError: unknown) {
        const err = menuError instanceof Error ? menuError : new Error(String(menuError));
        this.log.warn({ err }, "menu sync failed; core sync will continue");
      }

      // 10.5. Photo sync (replace-all with orphan cleanup, pending-writes filtered,
      // best-effort). Photos are a recipe-child entity with no standalone MCP
      // resource surface (the recipe resource inlines photo fields), so — exactly
      // like meals — this emits NO sync:complete event and adds NO SyncResult
      // variant. Isolated in its own try block so a photo-side failure cannot abort
      // the rest of the cycle; the photo read/write surface is strictly additive.
      try {
        this.log.debug("fetching photos");
        await syncReplaceAllEntity({
          fetch: () => this._context.client.listPhotos(),
          cache: this._context.cache.photos,
          store: this._context.photoStore,
          equals: photosEqual,
          label: "photos",
          log: this.log,
        });
      } catch (photoError: unknown) {
        const err = photoError instanceof Error ? photoError : new Error(String(photoError));
        this.log.warn({ err }, "photo sync failed; core sync will continue");
      }

      // 11. Finalization
      this.log.debug("flushing cache to disk");
      await this._context.cache.flush();

      // Sweep expired pending-writes (issue #57 TTL fallback). Pending-deletes
      // rely on this for clearing since Paprika gives no observable signal
      // that our soft-delete propagated.
      const sweptStore = this._context.store.sweepPending();
      const sweptCategories = this._context.categoryStore.sweepPending();
      const sweptPantry = this._context.pantryStore.sweepPending();
      const sweptAisles = this._context.aisleStore.sweepPending();
      const sweptGroceryLists = this._context.groceryListStore.sweepPending();
      const sweptGroceryItems = this._context.groceryItemStore.sweepPending();
      const sweptMeals = this._context.mealStore.sweepPending();
      const sweptMealTypes = this._context.mealTypeStore.sweepPending();
      const sweptMenus = this._context.menuStore.sweepPending();
      const sweptMenuItems = this._context.menuItemStore.sweepPending();
      const sweptPhotos = this._context.photoStore.sweepPending();
      if (
        sweptStore > 0 ||
        sweptCategories > 0 ||
        sweptPantry > 0 ||
        sweptAisles > 0 ||
        sweptGroceryLists > 0 ||
        sweptGroceryItems > 0 ||
        sweptMeals > 0 ||
        sweptMealTypes > 0 ||
        sweptMenus > 0 ||
        sweptMenuItems > 0 ||
        sweptPhotos > 0
      ) {
        this.log.debug(
          {
            sweptStore,
            sweptCategories,
            sweptPantry,
            sweptAisles,
            sweptGroceryLists,
            sweptGroceryItems,
            sweptMeals,
            sweptMealTypes,
            sweptMenus,
            sweptMenuItems,
            sweptPhotos,
          },
          "swept pending writes past TTL",
        );
      }

      // Partition fetched recipes: added vs updated
      const addedSet = new Set(filteredAdded);
      const addedRecipes = fetchedRecipes.filter((r) => addedSet.has(r.uid));
      const updatedRecipes = fetchedRecipes.filter((r) => !addedSet.has(r.uid));

      // Emit one sync:complete event per entity type. Subscribers decide whether
      // to notify based on changes content; syncOnce no longer calls the notifier
      // directly.
      const recipeResult: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: addedRecipes, updated: updatedRecipes, removedUids: filteredRemoved },
      };
      const pantryResult: PantrySyncResult = { changeType: "pantry", changes: pantryChanges };
      const groceryListResult: GroceryListSyncResult = { changeType: "grocery-lists", changes: groceryListChanges };
      const groceryItemResult: GroceryItemSyncResult = { changeType: "grocery-items", changes: groceryItemChanges };
      const menuResult: MenuSyncResult = { changeType: "menus", changes: menuChanges };
      const menuItemResult: MenuItemSyncResult = { changeType: "menu-items", changes: menuItemChanges };
      this._events.emit("sync:complete", recipeResult);
      this._events.emit("sync:complete", pantryResult);
      this._events.emit("sync:complete", groceryListResult);
      this._events.emit("sync:complete", groceryItemResult);
      this._events.emit("sync:complete", menuResult);
      this._events.emit("sync:complete", menuItemResult);

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
