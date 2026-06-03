# Caching Layer

Last verified: 2026-06-02

## Purpose

The in-memory query/CRUD stores that are each session's source of truth for one Paprika entity family. Tools and resources read these; the sync engine hydrates them; they never touch the filesystem. The store implementations live in their per-entity modules (`../<entity>/store.ts`) — this doc catalogs their shared behavior — while the durable **persistence layer** that backs them lives flat in this directory. See [Persistence](#persistence).

## Key References

- `../entity/CLAUDE.md` — the shared `EntityStore` / `TombstoneEntityStore` base classes and the canonical pending-write (#57) and tombstone invariants. Every store below inherits those unless noted; this file documents only what each store adds on top.
- [Persistence](#persistence) (below) — the on-disk layer (`DiskCacheRoot`, per-entity `DiskCache<T>` + the `DiskCacheDescriptor<T>` contract, on-disk layout, migration, mutex model, recipe `diff()`, DCR `tryPut`); each entity's descriptor is co-located in `../<entity>/disk.ts`.
- `docs/architecture.md` — the two-layer cache+sync model and the diff-and-fetch vs. replace-all split.
- Source: each entity's `../<entity>/store.ts` owns its method signatures and field shapes, and its `../<entity>/types.ts` owns the schema.

## Stores at a glance

The store implementations now live in their entity modules (`../<entity>/store.ts`, beside `types.ts` and `disk.ts`); this catalog names each one's base class and store-specific behavior only.

- `../recipe/store.ts` — `EntityStore`. Diff-and-fetch sync. FK-only for categories (see Sharp edges).
- `../category/store.ts` — `TombstoneEntityStore`. Single source of truth for category data; `resolveByName`/`resolveNames`/`getChildren`.
- `../pantry/store.ts` — `TombstoneEntityStore`. `findByIngredient` tiered lookup.
- `../aisle/store.ts` / `../meal-type/store.ts` — `EntityStore`, read-only reference catalogs (`resolveByName`, no delete/tombstone path).
- `../grocery-list/store.ts` / `../menu/store.ts` — `TombstoneEntityStore` parent stores (`findByName`, `lastSyncedAt`).
- `../grocery-item/store.ts` / `../menu-item/store.ts` — `TombstoneEntityStore` child stores keyed to a parent FK (`getByListUid` / `getByMenuUid`).
- `../grocery-ingredient/store.ts` — **plain class, NOT an EntityStore** (see Sharp edges).
- `../meal/store.ts` — `TombstoneEntityStore`. `getMaxOrderFlagOn` carries a reverse-engineered wire quirk (see Sharp edges).
- `../photo/store.ts` — `TombstoneEntityStore`, recipe-child entity with no standalone resource surface; `getByRecipeUid` gallery-sorted.
- Persistence (`disk-cache.ts`, `disk-cache-root.ts`, `oauth-client-disk-cache.ts`, and each entity's `../<entity>/disk.ts` descriptor) — see [Persistence](#persistence) below.

## Sharp edges

**RecipeStore is foreign-keys-only for categories; CategoryStore is the source of truth.** `RecipeStore` holds just the recipe→category UID list; rendering resolves names through `CategoryStore.resolveNames()`, which silently skips unknown UIDs (a recipe may reference a deleted/unknown category). Don't reintroduce category objects on the recipe.

**`RecipeStore.getAllIncludingTrashed()` exists for the `delete_category` guard, not for normal reads.** Every other read (`getAll`, `size`, `search`, `filterBy*`, `findByName`) excludes `inTrash` recipes; `get(uid)` returns a trashed recipe because direct UID lookup isn't filtered. The guard needs the unfiltered view so a trashed-but-restorable recipe still blocks deletion of a category it references; otherwise restoring it would surface a dangling category UID.

**`MealStore.getMaxOrderFlagOn(date)` sequences `order_flag` per CALENDAR DATE, not per (date, type), and excludes pending-deletes.** All meal types on a day share one ordering sequence: the wire capture shows two same-date meals of different types posting as 0 and 1, while two same-type meals on different dates both post as 0 (`docs/wire-captures/meals.har.json`). So the method matches on `date` only and takes no `typeUid`; legacy `typeUid: null` meals and every typed meal that day share the sequence. It also skips pending-delete UIDs: between `markPendingDelete` and `delete` the meal is still in `_items` with `deleted: false`, so without the filter a soft-delete + same-date add within the cache-flush window would inflate the new meal's flag.

**Meal "cooked" queries deliberately drop ingredient and future entries.** `getByRecipeUid` and `lastCookedAt` exclude `isIngredient: true` (prep-work, not a served meal), and `lastCookedAt` also excludes meals dated in the future; "last cooked" means actually eaten, not a planner entry scheduled for next Tuesday.

**`GroceryIngredientStore` is a plain class, not an `EntityStore`.** No pending-writes, no tombstones, no `sweepPending`; the sync engine never calls those for ingredients. It's keyed by lowercase name (case-insensitive lookup) and is replace-all only, so duplicate names differing by case collapse to one entry, last writer wins.

**Pending-writes (#57) is distinct from the tombstone set; clearing is content-equality-based, not UID-presence.** The tombstone set drives the delete tool's idempotent "already deleted" message; the pending-writes map shields the sync loop from rolling back or resurrecting an in-flight write. Upserts clear only on content equality (recipes by hash match against the canonical entry; pantry items field-wise via `pantryItemsEqual`); UID-presence-only clearing was rejected because a UID can appear in Paprika's canonical list with pre-write content while propagation is still in flight. The commit helpers (`commitRecipe` / `commitPantryItem`) wrap cache I/O in `try { … } catch { clearPending(uid); throw }` so a failed local commit doesn't shield the UID for the full TTL. The full invariant set is in `../entity/CLAUDE.md`.

## Persistence

On-disk persistence for every cached entity: one `DiskCache<T>` per entity behind a `DiskCacheRoot` composition root — the durable backing store that makes the server warm on restart, while the in-memory stores remain the session's source of truth. Tools never touch this layer.

**Files.** `disk-cache.ts` (generic `DiskCache<T>` + `writeFileAtomic` + the `DiskCacheDescriptor<T>` contract); `disk-cache-root.ts` (`DiskCacheRoot`: builds one subcache per entity, runs the legacy-index migration, fans `init`/`flush` out); `oauth-client-disk-cache.ts` (`OAuthClientDiskCache`, the atomic DCR cap — OAuth clients aren't a Paprika entity, so this stays here). The recipe subcache (`RecipeDiskCache`, hash index + `diff()`) lives with its entity at `../recipe/disk.ts`.

**Descriptors.** Each Paprika entity co-locates its persistence config — subdir name, `parse`, key extractor — as a `DiskCacheDescriptor<T>` in `../<entity>/disk.ts`; `DiskCacheRoot` joins the subdir against the cache dir and supplies the logger to turn each descriptor into a live `DiskCache`. Entities whose cache carries extra behavior (recipes' hash index, OAuth clients' atomic cap) subclass `DiskCache` instead of describing it. `oauthTokens` has no entity home, so its descriptor is module-local in `disk-cache-root.ts`. See `docs/architecture.md` ("Caching and sync") for the two-layer model and `docs/wire-format.md` for the recipe content-hash the `recipes` namespace diffs against.

### Persistence sharp edges

**Atomic durable writes, then swap state. Never the reverse.** `writeFileAtomic` opens the file, writes, **fsyncs the file handle**, then closes; every data file is durably on disk before the call returns. Callers must commit to disk before mutating in-memory state (the recipes index is rewritten only after the data files it references are durable). The inverse ordering would leave the in-memory view pointing at data that a crash could lose.

**One mutex per subcache; the root holds none.** Each `DiskCache<T>` owns its own `async-mutex` `Mutex`; `put`/`remove`/`flush` run exclusive, so concurrent calls on the _same_ subcache queue FIFO while different subcaches run in parallel. This is why `flush()` has no cross-entity atomic snapshot: each entity flushes independently, which is exactly what `paprika/sync.ts` needs (e.g. recipes and pantry are independent in the sync flow). A failed op does not poison the mutex (`async-mutex` releases on throw).

**No re-entrance inside the mutex.** A locked method must never call another locked method on the same instance or it deadlocks. Subclasses extend through the mutex-free `_putInner`/`_removeInner` helpers; the base's public `put`/`remove` acquire the mutex once, then call those internals.

**Corruption resets a namespace to empty, not to a crash.** Invalid JSON or a schema mismatch on `recipes/index.json` logs a `warn` and leaves the in-memory hash map empty rather than throwing; the next sync re-fetches and re-hashes everything, repopulating the index. ENOENT on a per-uid read, a directory listing, an unlink, or the legacy migration file is a normal cold-start/idempotent case and is silent. The principle: a corrupt or missing cache must degrade to "re-sync," never to a startup failure.

**The recipes index is temp-then-rename, inside the recipe mutex, on every flush.** `RecipeDiskCache._writePending` writes the uid→hash map to a `.index-<ts>.tmp` sibling and `rename`s it over `index.json` after `super._writePending()` has fsynced the data files. The rename is atomic, so a reader never sees a half-written index. Crash windows: die between data writes and the rename → new data files are durable and the _older_ index still references valid recipes (harmless); die during the rename → the old index stays in place and the next sync re-hashes the affected recipes. The index is rewritten unconditionally (even when `_pending` was empty) because `remove()` mutates the hash map without leaving a pending entry, so "nothing pending" does not imply "index current."

**Legacy-index migration writes the new file before deleting the old one.** `_maybeMigrateLegacyIndex` (one-shot, first boot) writes `recipes/index.json` atomically, _then_ unlinks the legacy unified `index.json`. A crash between leaves the legacy file in place; the next boot re-runs and overwrites the recipes index with identical content (idempotent), then retries the delete. Only the `recipes` namespace carried real hashes; every other legacy namespace stored placeholders equivalent to a directory listing, which each subcache rebuilds from `readdir` at init.

**`getAll()` reads the directory live; `_knownKeys` is only a hint.** `has()`/`size`/`tryPut`'s count check use the in-memory `_knownKeys` mirror, but `getAll()` does a fresh `readdir` so externally-seeded files (test fixtures, or another writer in the DCR-cap path) are visible immediately. Cross-instance count drift is inherent to "two writers, one directory" and is a non-issue in production (one `DiskCacheRoot` per process). I/O uses try/catch on `error.code`, never `existsSync`-then-read, to avoid a TOCTOU window.

## Boundary

Must not import from `tools/`, `resources/`, or `features/`. The persistence layer reaches into each `../<entity>/` for its disk descriptor and `Stored` schema (the `parse` each `DiskCache` runs), `../recipe/disk.js` for the bespoke `RecipeDiskCache`, and `../auth/types.js` for the OAuth client/token shapes. `DiskCacheRoot` is a composition root, so this cross-domain fan-in is expected.
