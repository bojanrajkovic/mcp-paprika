# Persistence Layer (`cache/disk/`)

Last verified: 2026-05-31

On-disk persistence for every entity the server caches: recipes, categories, pantry items, aisles, OAuth clients, OAuth tokens, grocery lists, grocery items, grocery ingredients, meals, meal types, menus, menu items, photos. The module exposes a generic base (`DiskCache<T>`), two specialised subclasses where the entity has behaviour beyond key-value storage (`RecipeDiskCache`, `OAuthClientDiskCache`), and a composition root (`DiskCacheRoot`) that owns one instance per entity plus a one-shot legacy-format migration. All three grocery entities, both meal entities, both menu entities, and photos use plain `DiskCache<T>` — no specialised subclass.

## Files

- `base.ts` — generic `DiskCache<T>` with init/get/getAll/put/remove/flush/has/size and a `_writePending` template-method hook.
- `recipes.ts` — `RecipeDiskCache extends DiskCache<Recipe>`; carries a uid → hash map for `diff()` and rewrites `recipes/index.json` on every flush.
- `oauth-clients.ts` — `OAuthClientDiskCache extends DiskCache<OAuthClient>`; adds `tryPut(client, max)` for atomic DCR-cap enforcement.
- `root.ts` — `DiskCacheRoot` composes fourteen subcaches (recipes, categories, pantry, aisles, oauthClients, oauthTokens, groceryLists, groceryItems, groceryIngredients, meals, mealTypes, menus, menuItems, photos), exposes `init()`/`flush()`, and runs the legacy-index migration on first boot.
- `index.ts` — barrel.

## On-disk layout

```
<cacheDir>/
├── recipes/
│   ├── index.json          ← uid → hash map (the only index file)
│   ├── <uid>.json          ← one per recipe
│   └── …
├── categories/<uid>.json
├── pantry/<uid>.json
├── aisles/<uid>.json
├── oauthClients/<clientId>.json
├── oauthTokens/<tokenHash>.json
├── grocerylists/<uid>.json
├── groceryitems/<uid>.json
├── groceryingredients/<uid>.json
├── meals/<uid>.json
├── mealtypes/<uid>.json
├── menus/<uid>.json
├── menuitems/<uid>.json
└── photos/<uid>.json
```

Directory names use lowercase (matching existing entity directory convention). The corresponding `DiskCacheRoot` fields use camelCase: `groceryLists`, `groceryItems`, `groceryIngredients`, `menuItems`. The `menus` directory and field share the same name.

The legacy unified `<cacheDir>/index.json` is gone. Only the `recipes` namespace carried real hashes; the other namespaces stored empty-string placeholders equivalent to the directory listing the new subcaches build on init.

## DiskCache&lt;T&gt; contract

| Method          | Signature                           | Notes                                                                                              |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `init()`        | `(): Promise<void>`                 | mkdir the subdir, readdir to seed `_knownKeys`, flip `_initialized`                                |
| `get(key)`      | `(key: string): Promise<T \| null>` | Pending entry first; falls back to disk; ENOENT → `null` (silent)                                  |
| `getAll()`      | `(): Promise<Array<T>>`             | Live `readdir` merged with pending entries (pending shadows disk for the same key)                 |
| `put(item)`     | `(item: T): Promise<void>`          | Mutex-guarded; buffers in `_pending`; updates `_knownKeys`. Subclasses override to bookkeep extras |
| `remove(key)`   | `(key: string): Promise<void>`      | Mutex-guarded; unlinks file (idempotent on ENOENT); drops from pending + `_knownKeys`              |
| `flush()`       | `(): Promise<void>`                 | Mutex-guarded; runs `_writePending` to write pending entries; subclasses extend                    |
| `has(key)`      | `(key: string): boolean`            | Hint based on `_pending ∪ _knownKeys`; may be stale w.r.t. external writes                         |
| `size` (getter) | `number`                            | Hint based on `_knownKeys.size`                                                                    |

**Construction (direct):**

```typescript
new DiskCache<Category>({
  subdir: join(cacheDir, "categories"),
  parse: (raw) => CategoryStoredSchema.parse(raw),
  getKey: (c) => c.uid,
  log,
});
```

`parse` wraps the Zod schema's `parse` rather than taking a schema directly — Zod's branded-type input/output variance can't be expressed cleanly through a single `ZodType<T>` parameter, and the parser-function shape keeps the base type contract independent of Zod.

### `_knownKeys` (in-memory mirror)

A `Set<string>` populated from `readdir` at init and maintained by `put`/`remove`. Used by `has()`, `size`, and `OAuthClientDiskCache.tryPut`'s atomic count check. It is **not** the source of truth for `getAll()` — that does a live `readdir` so externally-seeded files (test fixtures, the DCR cap middleware after another process wrote) are visible immediately.

### `_initialized` guard

Every method that needs disk state (`get`, `getAll`, `put`, `remove`, `flush`, `RecipeDiskCache.diff`) asserts `_initialized` and throws `"DiskCache: <method>() called before init()"` if not. This is a structural defence — the alternative was silently returning empty results.

### Mutex model

Each `DiskCache<T>` instance holds its own `async-mutex` `Mutex`. The root holds nothing. Concurrent calls on the same subcache queue in FIFO order; calls on different subcaches run in parallel. A failed operation does not poison the mutex — `async-mutex` releases on exception.

**No re-entrance.** A locked method must never call another locked method on the same instance — it would deadlock. Subclasses extend through `_putInner` and `_removeInner` (mutex-free internal helpers); the base's public `put`/`remove` acquire the mutex once and then call those internals.

## RecipeDiskCache

Adds three things to the base:

1. **Hash index.** A private `Map<string, string>` (`_hashes`) loaded from `<subdir>/index.json` at init and updated by `put`/`remove`. The on-disk file is rewritten atomically (temp-then-rename) inside the subclass's mutex at the end of every `_writePending`.
2. **`put(recipe)` override.** Calls `_putInner` then sets `_hashes[recipe.uid] = recipe.hash`. The hash comes from `recipe.hash` itself — every production call site already passed the same value as a second argument, so the dedicated parameter the old `putRecipe(recipe, hash)` API took was vestigial and was dropped.
3. **`diff(entries)`.** Pure in-memory diff classifying remote entries against `_hashes` into added / changed / removed. O(n + m). Reflects pending `put`s immediately (the map updates synchronously inside the mutex).

**Crash safety.** Recipe data files are fsynced individually before the index temp-then-rename. If the process dies between data writes and the rename, the new files are durably on disk and the (older) index references them. If it dies during the rename, the old index is still in place; the next sync re-fetches and re-hashes the affected recipes harmlessly.

## OAuthClientDiskCache

Adds one thing to the base:

**`tryPut(client, maxClients)`.** Atomic check-and-put inside the subcache mutex: counts `_knownKeys.size`, allows the put if under `maxClients` OR the `clientId` already exists (re-puts skip the count check), rejects otherwise with `{ ok: false, currentCount }`. Used by `DiskClientRegistrationStore.registerClient` as the authoritative race-safe DCR cap enforcement; the HTTP-level `buildClientCap` middleware does a non-atomic fast-path 429 ahead of this for the common single-request overflow.

The count check uses `_knownKeys.size` (in-memory mirror). That's correct _within this instance_; cross-instance count drift is inherent to any "two writers, one directory" setup and isn't a problem in production (one `DiskCacheRoot` per process).

## DiskCacheRoot

Owns one instance per entity and exposes `init()` + `flush()`. Construction:

```typescript
new DiskCacheRoot(cacheDir, log?)
```

Twelve entities that don't need behaviour beyond key-value storage (`categories`, `pantry`, `aisles`, `oauthTokens`, `groceryLists`, `groceryItems`, `groceryIngredients`, `meals`, `mealTypes`, `menus`, `menuItems`, `photos`) are instantiated directly from the base `DiskCache<T>` with a config object. The other two (`recipes`, `oauthClients`) are their dedicated subclasses.

`init()` is two-phase: first run `_maybeMigrateLegacyIndex` (see below), then `Promise.all` over each subcache's own `init()`.

`flush()` runs `Promise.all` over each subcache's `flush()`. There is no cross-entity atomic snapshot — each entity flushes independently, which is what `paprika/sync.ts` step 4 needs (recipes and pantry are independent in the sync flow). Within each entity, the flush remains atomic (files fsynced, recipes index temp-then-rename'd).

### Legacy-index migration

`_maybeMigrateLegacyIndex` runs once per init. Behaviour:

- **No legacy file present** (fresh install or already migrated) → no-op via ENOENT return.
- **Legacy file present with non-empty `recipes` map** → write the extracted hashes to `<cacheDir>/recipes/index.json` atomically, then delete the legacy file. Logs `info "migrated legacy unified index.json to recipes/index.json"` once.
- **Legacy file present with empty `recipes` map** (only placeholder namespaces) → delete the legacy file; no recipes index is written (the directory listing is the source of truth).
- **Legacy file is corrupt JSON or wrong shape** → log a warn record, delete it, continue. Recipes get re-hashed on the next sync.

**Crash safety.** Write the new recipes index BEFORE deleting the legacy file. A crash between leaves the legacy file in place; on the next boot the migration re-runs and overwrites the recipes index idempotently, then retries the delete. A crash between rename and unlink leaves the same state, same recovery.

**Idempotency.** Re-running with both files present overwrites the recipes index with the same content (since `_hashes` is rebuilt from the legacy file), then deletes legacy. Re-running with only the recipes index present is a no-op (ENOENT).

## Per-entity invariants

- **OAuth-client filenames** use `${clientId}.json` — `clientId` is a UUIDv4 issued by `@modelcontextprotocol/sdk`. `OAuthClientSchema` validates the shape on every parse.
- **OAuth-token filenames** use `${tokenHash}.json` — `tokenHash` is the 64-character lowercase hex SHA-256 of the plaintext bearer token. `OAuthTokenSchema` enforces the regex on every parse, so filename-equals-field is enforced at both write and read.
- **Plaintext tokens never appear on disk.** The token-store layer hashes before calling `oauthTokens.put`.
- **No client secrets exist.** Public-client only — `OAuthClientSchema` has no `clientSecret` or `clientSecretHash` field.

## Logger integration

Constructor accepts an optional `log?: Logger`; defaults to `SILENT_LOG`. In production, `buildAppContext` constructs `new DiskCacheRoot(getCacheDir(), log.child({ component: "disk-cache" }))`. Tests omit the argument.

**Catch-site classification:**

- ENOENT on a per-uid read → cold-start cache miss; silent (returns `null`).
- ENOENT on directory listing → empty entity; silent (returns `[]`).
- ENOENT on unlink → idempotent removal; silent.
- ENOENT on the legacy `index.json` in migration → no migration needed; silent.
- Corrupt JSON in `recipes/index.json` → emits `warn "corrupt recipes index.json, resetting to empty index"`; recipes get re-hashed on the next sync.
- Schema mismatch on `recipes/index.json` → emits `warn "schema mismatch on recipes index.json, resetting to empty index"`.
- Corrupt or malformed legacy `index.json` → emits `warn "corrupt legacy index.json — discarding"` or `warn "legacy index.json present but recipes namespace is missing or malformed — discarding"`; the file is deleted.

## Adding another entity

1. New file `src/cache/disk/<entity>.ts` — only if the entity needs behaviour beyond key-value (a separate index, an atomic check-and-put, etc.). If it doesn't, skip this step.
2. In `DiskCacheRoot`'s constructor: one config object (or one `new <Entity>DiskCache({...})` call), one `_subcaches` array entry.

Adding a category-style entity that just needs CRUD is one config object; no new files.

## Dependencies

- **Uses:** Node `fs/promises`, `async-mutex`, `zod`, `pino`, `../../paprika/types` (recipe/category/pantry schemas), `../../auth/types` (OAuth schemas), `../../utils/errors` (`isNodeError`), `../../utils/log` (`SILENT_LOG`).
- **Used by:** `src/paprika/sync.ts`, `src/server/build.ts`, `src/e2e-server.ts`, `src/auth/build.ts` (and downstream auth modules: `cleanup`, `client-registration`, `token-store`, `routes`), `src/transport/http.ts` (DCR cap middleware).
- **Boundary:** Must not import from `tools/`, `resources/`, `features/`.
