# Paprika API Client

Last verified: 2026-06-04

## Purpose

The Paprika Cloud Sync API client and the background sync engine: authentication, wire-format encode/decode (Zod schemas), resilient HTTP, and the poll-and-reconcile loop that keeps the local cache and in-memory stores fresh.

## Key References

- **Wire format** — [`docs/wire-format.md`](../../docs/wire-format.md) is the canonical narrative for _why_ the wire looks the way it does: the v2 gzipped-multipart envelope, the recipe content-hash algorithm and parity check, the two-tier deletion shapes, the photo-upload choreography, and grocery-ingredient auto-creation. The literal byte corpus lives in [`docs/wire-captures/`](../../docs/wire-captures/).
- **Caching, sync, resilience** — [`docs/architecture.md`](../../docs/architecture.md): diff-and-fetch (recipes) vs replace-all (everything else), the never-throws sync contract, resource-notification fan-out, and the shared cockatiel retry+breaker executor.
- **Source of truth for shapes** — `types.ts` owns every branded UID, entity field list, wire/stored Zod schema, and `*ToApiPayload` mapper. `client.ts` owns the `PaprikaClient` method set, the resilience-hook wiring, and attempt numbering. `sync.ts` owns `syncReplaceAllEntity` (the replace-all reconcile helper each domain's sync contribution calls) and the legacy `SyncEngine` class — transitional, kept alive only to back the sync-coverage tests until they are ported to the kernel (#20); the live sync path is the kernel's `syncOnce` driver over per-module reconciles. Don't re-enumerate these here; read the file.
- **Date/time helpers** for the `yyyy-MM-dd HH:mm:ss` wire boundary live in `src/utils/dates.ts` (see `src/utils/CLAUDE.md`).
- **ADRs** — [`docs/adr/`](../../docs/adr/), notably 0004 (tool-vs-resource classification, which governs which sync changes fan out a resource notification).

## Sharp edges

- **Two URL conventions, and which one an entity uses is part of the contract.** Recipes and photos address a **singular** URL with the UID in the path (`/sync/recipe/{uid}/`, `/sync/photo/{uid}/`). Everything else upserts to a **collection** URL with the UID only in the body (`/sync/pantry/`, `/sync/groceries/`, …): the server creates on an unseen UID, so there is no separate create-vs-update on the wire. The natural assumption is that every entity follows the recipe's path-UID pattern; it doesn't, so each diverging save method calls it out.

- **`stampContentHash` is the single write-side hash chokepoint, with exactly one exception.** Every recipe write recomputes the content hash there (`saveRecipe` and `uploadPhoto` both route through it and return the stamped recipe, so the POSTed body and the locally-committed recipe always agree), including a soft-delete / `inTrash` toggle, because the hash is trash-independent and recomputing a pure trash flip is a no-op. The **one** exception is the hard-delete tombstone (`deleted: true`), which echoes the stored hash **verbatim**: Paprika validates the `deleted` transition against the server-side hash, so a recomputed or blanked hash would be rejected (#125, #167).

- **Sync filters the recipe diff through pending-writes, and upserts vs deletes clear differently (#57).** A just-written UID's canonical entry still reflects pre-write state, so applying it would roll back or resurrect a local change. Therefore: `removed` drops pending-**upsert** UIDs (deleting would undo our write) but lets pending-**delete** UIDs through (if the server truly no longer lists it, honoring the removal is correct); `added`/`changed` drop both. Pending-**upserts clear on observation**: only once the canonical entry's hash (recipes) or full content (`equals`, other entities) matches our cache, never on UID presence alone, because the UID appears with the stale hash while propagation is in flight. Pending-**deletes clear only on TTL sweep**, because absence is ambiguous: Paprika gives no positive signal that a soft-delete propagated.

- **Sync is never-throws and never calls the notifier directly.** The kernel's `syncOnce` driver catches every error and continues; resource-list notification is the interval loop's job — `notifyFromResults` (`src/server/sync-loop.ts`) fires off the `AnySyncResult[]` a completed cycle returns, not the reconcile. Each domain's reconcile (`syncReplaceAllEntity` for replace-all entities, the bespoke diff-and-fetch for recipes) propagates its errors to the driver, which runs `core` reconciles first (a throw aborts the cycle) and isolates `additive` ones (meals/menus/photos) in their own best-effort handling so an additive read surface can't abort core sync. (`syncReplaceAllEntity` itself throws on a fetch/cache failure — it's the driver that swallows.)

- **No-aisle grocery ingredients are dropped on sync.** Paprika returns `aisle_uid: null` for an ingredient never filed into an aisle (the schema coerces null → `""`). Such a row carries no aisle memory; resolving it yields the same Miscellaneous default as no catalog entry at all, so the sync layer drops it (with a single `warn`-level count). Historically the un-nullable schema also _threw_ on these rows, aborting the whole cycle before meals/menus could sync.

- **Recipe deletes ping `notify`.** `deleteRecipe`/`hardDeleteRecipe` call `notifySync()` after the write to nudge cross-client sync propagation; the collection-style entity writes do not.
