# Caching Layer

Last verified: 2026-06-01

## Purpose

The in-memory query/CRUD stores that are each session's source of truth for one Paprika entity family. Tools and resources read these; the sync engine hydrates them. Never touches the filesystem; the disk layer lives under `disk/`.

## Key References

- `../entity/CLAUDE.md` — the shared `EntityStore` / `TombstoneEntityStore` base classes and the canonical pending-write (#57) and tombstone invariants. Every store below inherits those unless noted; this file documents only what each store adds on top.
- `disk/CLAUDE.md` — the persistence layer (`DiskCacheRoot`, per-entity `DiskCache<T>`, on-disk layout, migration, mutex model, recipe `diff()`, DCR `tryPut`).
- `docs/architecture.md` — the two-layer cache+sync model and the diff-and-fetch vs. replace-all split.
- Source: the `*-store.ts` files own method signatures and field shapes. The `Recipe`/`Category`/`Meal`/… types live in `../paprika/types.ts`.

## Stores at a glance

Each entry below names the base class and the store-specific behavior only.

- `recipe-store.ts` — `EntityStore`. Diff-and-fetch sync. FK-only for categories (see Sharp edges).
- `category-store.ts` — `TombstoneEntityStore`. Single source of truth for category data; `resolveByName`/`resolveNames`/`getChildren`.
- `pantry-store.ts` — `TombstoneEntityStore`. `findByIngredient` tiered lookup.
- `aisle-store.ts` / `meal-type-store.ts` — `EntityStore`, read-only reference catalogs (`resolveByName`, no delete/tombstone path).
- `grocery-list-store.ts` / `menu-store.ts` — `TombstoneEntityStore` parent stores (`findByName`, `lastSyncedAt`).
- `grocery-item-store.ts` / `menu-item-store.ts` — `TombstoneEntityStore` child stores keyed to a parent FK (`getByListUid` / `getByMenuUid`).
- `grocery-ingredient-store.ts` — **plain class, NOT an EntityStore** (see Sharp edges).
- `meal-store.ts` — `TombstoneEntityStore`. `getMaxOrderFlagOn` carries a reverse-engineered wire quirk (see Sharp edges).
- `photo-store.ts` — `TombstoneEntityStore`, recipe-child entity with no standalone resource surface; `getByRecipeUid` gallery-sorted.
- `disk/` — persistence; see `disk/CLAUDE.md`.

## Sharp edges

**RecipeStore is foreign-keys-only for categories; CategoryStore is the source of truth.** `RecipeStore` holds just the recipe→category UID list; rendering resolves names through `CategoryStore.resolveNames()`, which silently skips unknown UIDs (a recipe may reference a deleted/unknown category). Don't reintroduce category objects on the recipe.

**`RecipeStore.getAllIncludingTrashed()` exists for the `delete_category` guard, not for normal reads.** Every other read (`getAll`, `size`, `search`, `filterBy*`, `findByName`) excludes `inTrash` recipes; `get(uid)` returns a trashed recipe because direct UID lookup isn't filtered. The guard needs the unfiltered view so a trashed-but-restorable recipe still blocks deletion of a category it references; otherwise restoring it would surface a dangling category UID.

**`MealStore.getMaxOrderFlagOn(date)` sequences `order_flag` per CALENDAR DATE, not per (date, type), and excludes pending-deletes.** All meal types on a day share one ordering sequence: the wire capture shows two same-date meals of different types posting as 0 and 1, while two same-type meals on different dates both post as 0 (`docs/wire-captures/meals.har.json`). So the method matches on `date` only and takes no `typeUid`; legacy `typeUid: null` meals and every typed meal that day share the sequence. It also skips pending-delete UIDs: between `markPendingDelete` and `delete` the meal is still in `_items` with `deleted: false`, so without the filter a soft-delete + same-date add within the cache-flush window would inflate the new meal's flag.

**Meal "cooked" queries deliberately drop ingredient and future entries.** `getByRecipeUid` and `lastCookedAt` exclude `isIngredient: true` (prep-work, not a served meal), and `lastCookedAt` also excludes meals dated in the future; "last cooked" means actually eaten, not a planner entry scheduled for next Tuesday.

**`GroceryIngredientStore` is a plain class, not an `EntityStore`.** No pending-writes, no tombstones, no `sweepPending`; the sync engine never calls those for ingredients. It's keyed by lowercase name (case-insensitive lookup) and is replace-all only, so duplicate names differing by case collapse to one entry, last writer wins.

**Pending-writes (#57) is distinct from the tombstone set; clearing is content-equality-based, not UID-presence.** The tombstone set drives the delete tool's idempotent "already deleted" message; the pending-writes map shields the sync loop from rolling back or resurrecting an in-flight write. Upserts clear only on content equality (recipes by hash match against the canonical entry; pantry items field-wise via `pantryItemsEqual`); UID-presence-only clearing was rejected because a UID can appear in Paprika's canonical list with pre-write content while propagation is still in flight. The commit helpers (`commitRecipe` / `commitPantryItem`) wrap cache I/O in `try { … } catch { clearPending(uid); throw }` so a failed local commit doesn't shield the UID for the full TTL. The full invariant set is in `../entity/CLAUDE.md`.

## Boundary

Must not import from `tools/`, `resources/`, or `features/`. Depends on `../entity/` (base classes), `../paprika/types`, and `../utils/duration`.
