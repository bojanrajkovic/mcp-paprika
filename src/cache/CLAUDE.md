# Caching Layer

Last verified: 2026-06-06

## Purpose

The in-memory query/CRUD stores that are each session's source of truth for one Paprika entity family. Tools and resources read these; each module hydrates its own stores from the disk cache on construction (via the shared `hydrateStore` helper in `hydrate.ts`); they never touch the filesystem. The store implementations live in their per-entity modules (`../domains/<domain>/store.ts`) — this doc catalogs their shared behavior — while the durable **persistence layer** that backs them lives flat in this directory. See [Persistence](#persistence).

## Key References

- `../entity/CLAUDE.md` — the shared `EntityStore` base class and the canonical pending-write (#57) invariants. Every store inherits those unless noted in Sharp edges; this file documents only what each store adds on top.
- [Persistence](#persistence) (below) — the on-disk layer (per-entity `DiskCache<T>` + the `DiskCacheDescriptor<T>` contract, on-disk layout, mutex model, recipe `diff()`); each entity's descriptor is co-located in its `../domains/<domain>/types.ts` (a behavior-carrying cache like recipe's keeps a dedicated `disk.ts`).
- `docs/architecture.md` — the two-layer cache+sync model and the diff-and-fetch vs. replace-all split.
- Source: each entity's `../domains/<domain>/store.ts` owns its method signatures and field shapes, and its `../domains/<domain>/types.ts` owns the schema.

## Stores at a glance

Every store extends `EntityStore`, except `grocery-ingredient` — a plain name-keyed class (see Sharp edges). `aisle` / `meal-type` are reference catalogs with a managed lifecycle — auto-create, edit, and tombstone delete, with the delete tools homed where the referencing entities are visible; the semantics and homing live in [ADR-0017](../../docs/adr/0017-reference-catalog-management-tools.md), the roster in the registry.

## Sharp edges

**RecipeStore is foreign-keys-only for categories; CategoryStore is the source of truth.** `RecipeStore` holds just the recipe→category UID list; rendering resolves names through `CategoryStore.resolveNames()`, which silently skips unknown UIDs (a recipe may reference a deleted/unknown category). Don't reintroduce category objects on the recipe.

**`RecipeStore.getAllIncludingTrashed()` exists for the `delete_category` guard, not for normal reads.** Every other read (`getAll`, `size`, `search`, `filterBy*`, `findByName`) excludes `inTrash` recipes; `get(uid)` returns a trashed recipe because direct UID lookup isn't filtered. The guard needs the unfiltered view so a trashed-but-restorable recipe still blocks deletion of a category it references; otherwise restoring it would surface a dangling category UID.

**`MealStore.getMaxOrderFlagOn(date)` sequences `order_flag` per CALENDAR DATE, not per (date, type), and excludes pending-deletes.** All meal types on a day share one ordering sequence: the wire capture shows two same-date meals of different types posting as 0 and 1, while two same-type meals on different dates both post as 0 (`docs/wire-captures/meals.har.json`). So the method matches on `date` only and takes no `typeUid`; legacy `typeUid: null` meals and every typed meal that day share the sequence. It also skips pending-delete UIDs: between `markPendingDelete` and `delete` the meal is still in `_items` with `deleted: false`, so without the filter a soft-delete + same-date add within the cache-flush window would inflate the new meal's flag.

**Meal "cooked" queries deliberately drop ingredient and future entries.** `getByRecipeUid` and `lastCookedAt` exclude `isIngredient: true` (prep-work, not a served meal), and `lastCookedAt` also excludes meals dated in the future; "last cooked" means actually eaten, not a planner entry scheduled for next Tuesday.

**`GroceryIngredientStore` is a plain class, not an `EntityStore`.** No pending-writes, no `sweepPending`; sync never calls those for ingredients. It's keyed by lowercase name (case-insensitive lookup) and is replace-all only, so duplicate names differing by case collapse to one entry, last writer wins.

**Pending-writes (#57) clearing is content-equality-based, not UID-presence.** The pending-writes map shields the sync loop from rolling back or resurrecting an in-flight write. Upserts clear only on content equality (recipes by hash match against the canonical entry; pantry items by content equality via `pantryItemsEqual`); UID-presence-only clearing was rejected because a UID can appear in Paprika's canonical list with pre-write content while propagation is still in flight. The commit helpers (`commitRecipe` / `commitPantryItem`) chain cache I/O as a `ResultAsync` whose `mapErr` runs `clearPending(uid)` before surfacing the error, so a failed local commit doesn't shield the UID for the full TTL. The full invariant set is in `../entity/CLAUDE.md`.

## Persistence

On-disk persistence for every cached entity: one `DiskCache<T>` per entity — the durable backing store that makes the server warm on restart, while the in-memory stores remain the session's source of truth. Each domain module builds its own subcaches in its `.state` factory, pointing each at its flat `<cacheDir>/<entity>` subdir; there is no central composition root. The HTTP transport's auth caches come from `buildAuthCaches` (`../auth/disk.ts`). Tools never touch this layer.

**Files and descriptors.** `disk-cache.ts` is the whole generic layer; the `DiskCacheDescriptor<T>` doc-comment there is the canonical description of the per-entity descriptor contract (don't restate it here). Behavior-carrying subcaches live with their owner, not here — the recipe and auth subcaches are the two (their `disk.ts` files carry the why). See `docs/architecture.md` ("Caching and sync") for the two-layer model and `docs/wire-format.md` for the recipe content-hash the `recipes` namespace diffs against.

### Persistence sharp edges

**Atomic durable writes, then swap state. Never the reverse.** `writeFileAtomic` opens the file, writes, **fsyncs the file handle**, then closes; every data file is durably on disk before the call returns. Callers must commit to disk before mutating in-memory state (the recipes index is rewritten only after the data files it references are durable). The inverse ordering would leave the in-memory view pointing at data that a crash could lose.

**One mutex per subcache; there is no shared lock.** Each `DiskCache<T>` owns its own `async-mutex` `Mutex`; `put`/`remove`/`flush` run exclusive, so concurrent calls on the _same_ subcache queue FIFO while different subcaches run in parallel. This is why `flush()` has no cross-entity atomic snapshot: each entity flushes independently, which is exactly what `paprika/sync.ts` needs (e.g. recipes and pantry are independent in the sync flow). A failed op does not poison the mutex (it releases when the op settles, ok or err).

**No re-entrance inside the mutex.** A locked method must never call another locked method on the same instance or it deadlocks. Subclasses extend through the mutex-free `_putInner`/`_removeInner` helpers; the base's public `put`/`remove` acquire the mutex once, then call those internals.

**Corruption resets a namespace to empty, not to a crash.** Invalid JSON or a schema mismatch on `recipes/index.json` logs a `warn` and leaves the in-memory hash map empty rather than throwing; the next sync re-fetches and re-hashes everything, repopulating the index. ENOENT on a per-uid read, a directory listing, or an unlink is a normal cold-start/idempotent case and is silent. The principle: a corrupt or missing cache must degrade to "re-sync," never to a startup failure.

**The recipes index is temp-then-rename, inside the recipe mutex, on every flush.** `RecipeDiskCache._writePending` writes the uid→hash map to a `.index-<ts>.tmp` sibling and `rename`s it over `index.json` after `super._writePending()` has fsynced the data files. The rename is atomic, so a reader never sees a half-written index. Crash windows: die between data writes and the rename → new data files are durable and the _older_ index still references valid recipes (harmless); die during the rename → the old index stays in place and the next sync re-hashes the affected recipes. The index is rewritten unconditionally (even when `_pending` was empty) because `remove()` mutates the hash map without leaving a pending entry, so "nothing pending" does not imply "index current."

**`getAll()` reads the directory live; `_knownKeys` is only a hint.** `has()`/`size`/`tryPut`'s count check use the in-memory `_knownKeys` mirror, but `getAll()` does a fresh `readdir` so externally-seeded files (test fixtures, or another writer in the DCR-cap path) are visible immediately. Cross-instance count drift is inherent to "two writers, one directory" and is a non-issue in production (each entity has a single owning module, so one writer per subcache per process). Every fs call converts to a `Result` at its edge (`enoentOk` recovers the cold-start/idempotent ENOENT cases — ADR-0014), never `existsSync`-then-read, to avoid a TOCTOU window.
