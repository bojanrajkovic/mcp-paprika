# Persistence Layer (`cache/disk/`)

Last verified: 2026-06-01

## Purpose

On-disk persistence for every cached entity. One `DiskCache<T>` instance per entity behind a `DiskCacheRoot` composition root; this is the durable backing store that makes the server warm on restart, while the in-memory stores remain the session's source of truth. Tools never touch this layer.

## Key References

- `docs/architecture.md` ("Caching and sync") — the conceptual two-layer model and why disk I/O stays off the hot path.
- `../CLAUDE.md` — the per-store method surface and `DiskCacheRoot`'s public API (`init`/`flush`, `recipes.diff`, `oauthClients.tryPut`); the full entity roster lives there and in `root.ts`.
- `docs/wire-format.md` — the reverse-engineered recipe content-hash algorithm the `recipes` namespace diffs against.
- Source: `base.ts` (generic `DiskCache<T>` + `writeFileAtomic`), `recipes.ts` (`RecipeDiskCache`, hash index), `oauth-clients.ts` (`OAuthClientDiskCache`, atomic DCR cap), `root.ts` (`DiskCacheRoot`, legacy-index migration).

## Sharp edges

**Atomic durable writes, then swap state. Never the reverse.** `writeFileAtomic` opens the file, writes, **fsyncs the file handle**, then closes; every data file is durably on disk before the call returns. Callers must commit to disk before mutating in-memory state (the recipes index is rewritten only after the data files it references are durable). The inverse ordering would leave the in-memory view pointing at data that a crash could lose.

**One mutex per subcache; the root holds none.** Each `DiskCache<T>` owns its own `async-mutex` `Mutex`; `put`/`remove`/`flush` run exclusive, so concurrent calls on the _same_ subcache queue FIFO while different subcaches run in parallel. This is why `flush()` has no cross-entity atomic snapshot: each entity flushes independently, which is exactly what `paprika/sync.ts` needs (e.g. recipes and pantry are independent in the sync flow). A failed op does not poison the mutex (`async-mutex` releases on throw).

**No re-entrance inside the mutex.** A locked method must never call another locked method on the same instance or it deadlocks. Subclasses extend through the mutex-free `_putInner`/`_removeInner` helpers; the base's public `put`/`remove` acquire the mutex once, then call those internals.

**Corruption resets a namespace to empty, not to a crash.** Invalid JSON or a schema mismatch on `recipes/index.json` logs a `warn` and leaves the in-memory hash map empty rather than throwing; the next sync re-fetches and re-hashes everything, repopulating the index. ENOENT on a per-uid read, a directory listing, an unlink, or the legacy migration file is a normal cold-start/idempotent case and is silent. The principle: a corrupt or missing cache must degrade to "re-sync," never to a startup failure.

**The recipes index is temp-then-rename, inside the recipe mutex, on every flush.** `RecipeDiskCache._writePending` writes the uid→hash map to a `.index-<ts>.tmp` sibling and `rename`s it over `index.json` after `super._writePending()` has fsynced the data files. The rename is atomic, so a reader never sees a half-written index. Crash windows: die between data writes and the rename → new data files are durable and the _older_ index still references valid recipes (harmless); die during the rename → the old index stays in place and the next sync re-hashes the affected recipes. The index is rewritten unconditionally (even when `_pending` was empty) because `remove()` mutates the hash map without leaving a pending entry, so "nothing pending" does not imply "index current."

**Legacy-index migration writes the new file before deleting the old one.** `_maybeMigrateLegacyIndex` (one-shot, first boot) writes `recipes/index.json` atomically, _then_ unlinks the legacy unified `index.json`. A crash between leaves the legacy file in place; the next boot re-runs and overwrites the recipes index with identical content (idempotent), then retries the delete. Only the `recipes` namespace carried real hashes; every other legacy namespace stored placeholders equivalent to a directory listing, which each subcache rebuilds from `readdir` at init.

**`getAll()` reads the directory live; `_knownKeys` is only a hint.** `has()`/`size`/`tryPut`'s count check use the in-memory `_knownKeys` mirror, but `getAll()` does a fresh `readdir` so externally-seeded files (test fixtures, or another writer in the DCR-cap path) are visible immediately. Cross-instance count drift is inherent to "two writers, one directory" and is a non-issue in production (one `DiskCacheRoot` per process). I/O uses try/catch on `error.code`, never `existsSync`-then-read, to avoid a TOCTOU window.
