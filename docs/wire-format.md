# Paprika Cloud Sync — Reverse-Engineered Wire Format

Paprika's Cloud Sync API has no public documentation. Everything here was
reconstructed by watching the macOS desktop client on the wire and reading the
shipped framework, then pinned in the codebase so it can't drift silently. This
file explains _why_ the formats are shaped the way they are, and _how_ we keep
the reconstruction honest.

For the literal request/response corpus (exact field names, types, and byte
shapes), see [`docs/wire-captures/README.md`](wire-captures/README.md) and the
sanitized HAR recordings beside it.

## How the wire is reconstructed and verified

The API is treated as an adversary that can change under us. Three layers guard
against that:

1. **Capture.** Traffic is recorded against the real macOS client through
   mitmproxy, decoded, credential-redacted, host-normalized, and emitted as
   sanitized HAR 1.2 files under `docs/wire-captures/`. The conversion pipeline
   preserves native JSON value types byte-equivalently (`null` stays `null`,
   `""` stays `""`, an integer stays an integer), because the wire format is
   sensitive to exactly those distinctions and a lossy decode would invent a
   format the server never sent. Hand-constructing HAR entries from ad-hoc
   decode output is explicitly _not_ the workflow: doing so has produced real
   field-shape bugs in the past, which is why captures flow through the
   deterministic converter rather than human transcription.

2. **Typed fixtures.** `pnpm generate:fixtures` turns each HAR file into a typed
   TypeScript module keyed by the human-readable `comment` string on each entry.
   Tests import these as ground truth, so the real wire shape, not a programmer's
   memory of it, is what schemas are validated against, and a typo'd fixture key
   is a compile error rather than a silent miss.

3. **Drift detection.** Because the fixtures are generated from real traffic, a
   future Paprika release that renames a field or changes an encoding shows up as
   a fixture diff and a failing test, instead of a quietly-wrong write that the
   server rejects (or, worse, accepts and corrupts). The same philosophy drives
   the content-hash parity fixtures described below.

When you need to capture a new endpoint, the `capture-paprika-wire-format` skill
orchestrates the whole pipeline.

## Authentication: v1 login, v2 everything else

The API straddles two versions. Authentication is the lone v1 endpoint
(`/api/v1/account/login/`); every data operation is v2 (`/api/v2/sync/...`).
This split is not cosmetic; the two halves disagree on encoding:

- **Login is form-encoded.** Credentials go up as `application/x-www-form-urlencoded`,
  not JSON and not multipart. The endpoint returns a bearer token that authorizes
  all subsequent v2 requests.
- **Everything else is gzipped multipart.** v2 writes do not send JSON bodies
  directly; see below.

Authentication is also the one place where the resilience policy is deliberately
_thinner_ than on data requests: it retries transient blips but does not arm the
circuit breaker, because startup auth is one-shot rather than a hot path, and a
real credential rejection should fail fast rather than trip a breaker.

## The v2 write envelope: gzipped multipart, never raw JSON

Every v2 write (recipe, category, pantry, grocery list/item/ingredient, meal,
menu, menuitem, photo metadata) uses the same envelope, because that is what
the desktop client emits and the server expects:

- The payload is serialized to JSON, **gzip-compressed**, wrapped in a multipart
  form, and attached under the field name `data`. There is no uncompressed JSON
  path; sending plain JSON does not work.
- The payload is **always a JSON array**, even for a single entity. The client
  batches when several changes happen close together, and the server accepts a
  one-element array identically, so the code path is uniform whether it writes
  one item or many.

A single naming wrinkle survives from the captures: recipe writes attach the
gzipped part with filename `data.gz`, while the collection-style writes use the
default filename `file`. The server treats these the same; the distinction is
preserved only to match the client byte-for-byte and avoid spurious diffs when
re-capturing.

### Singular URL vs. collection URL: where the UID lives

Two URL conventions coexist, and which one an entity uses is itself part of the
reverse-engineered contract:

- **Recipes (and photos) address a singular URL with the UID in the path**
  (`/sync/recipe/{uid}/`, `/sync/photo/{uid}/`). The UID is in the path _and_ in
  the body.
- **Everything else POSTs to a collection URL with no UID in the path**
  (`/sync/pantry/`, `/sync/groceries/`, `/sync/categories/`, …). The UID lives
  only in the body, and the server upserts by it: POSTing a body whose UID it has
  never seen _creates_ the entity. There is no separate create-vs-update
  distinction on the wire; both are the same POST.

This asymmetry is easy to get wrong (the natural assumption is that every entity
follows the recipe's path-UID pattern), so it is called out explicitly wherever
a save method diverges.

### "All fields required on save": writes are full-object replacements

The collection upsert is a **whole-object replace, not a partial patch.** The
server stores exactly the body it receives; any field omitted from the POST is
not "left unchanged"; it is effectively cleared. This shapes how every update
tool is written: an update reads the cached entity, spreads it in full, overlays
only the fields the caller actually changed, and POSTs the merged whole. The
in-memory store backed by the disk cache is what makes this safe: it is the
authoritative pre-image to merge onto, so the server never receives a body that
silently drops the fields the caller did not mention.

One field bucks "send everything": the macOS client omits the pantry item's
`notes` field from its POST bodies, so the write path matches that omission
rather than the entity's full read shape. That kind of asymmetry is exactly what
the capture corpus exists to pin down.

## UID shapes: what the server mints and what it accepts

The UID namespace is Paprika's, not ours, and the two halves of that — what the
server will _accept_ from a client and what it _mints_ itself — do not match.
This is hard-won knowledge, verified directly against the live API, and it is
why identifier branding stays compile-time only (see
[`docs/adr/0007-uid-branding-compile-time-only.md`](adr/0007-uid-branding-compile-time-only.md)).

**On write, the server validates the _shape_ of a client-minted UID.** A new UID
in a POST body (collection upsert) or a recipe path is accepted only if it is a
canonical `8-4-4-4-12` hex UUID — case-insensitive, hex in every position. A
prefix (`recipe_…`), a trailing suffix, hyphen-free hex, or any length-36 string
that is not that exact structure is refused. The refusal is easy to miss: it
comes back as **HTTP 200 with an error body** (`{"error":{"message":"Invalid uid."}}`),
not a 4xx, so a `200` is not on its own a success — the client maps a non-`{"result":…}`
200 to a `PaprikaAPIError`. The validator is a regex, not full UUID semantics: a
structurally-valid string with an invalid version/variant nibble is still accepted.

**The server itself mints UIDs in shapes a client could not POST.** Built-in
aisles, meal types, and the default grocery list carry **64-hex hyphen-free**
identifiers (the long aisle UID noted under the no-aisle sentinel above is one of
these); a large share of recipes and categories carry **compound
`<uuid>-<decimal>-<hex>`** identifiers from import/share flows. Neither shape
passes the client-write validator, so these entities are effectively
system-owned: they cannot be re-created under the same UID, and the reference
catalogs are re-seeded by the app if deleted.

**Updating an _existing_ server-known UID is accepted regardless of its shape.**
The shape validator gates the minting of a _new_ UID, not a write that addresses
a UID the server already stores. A recipe with a compound UID round-trips and is
editable through the normal save path (the UID is folded into the recipe content
hash, and that hash matches on re-save). So the heterogeneous corpus is fully
writable even though most of it could never be _created_ by this client.

The practical consequence: this server mints plain canonical UUIDs (uppercased,
matching the desktop client's own format) and treats every UID as an opaque,
kind-agnostic string at runtime. It cannot enforce a UID's kind from its shape,
because the shapes the server issues do not encode kind and are not ours to choose.

## Deletion: two tiers, two shapes

Deletion is where the wire format is least intuitive, because Paprika models
_move to trash_ and _permanently delete_ as distinct states, and because the
shape differs between recipes and everything else.

- **Soft delete (reversible).** For collection-style entities, a soft delete is
  just an ordinary upsert with `deleted: true` toggled on the otherwise-complete
  body, POSTed to the same collection URL as a normal write. There is no separate
  delete endpoint; the flag _is_ the delete. Recipes express the same idea with
  `in_trash: true` (and `deleted: false`) on the full recipe object at the
  singular recipe URL, moving a recipe to the trash, recoverable until the trash
  is emptied. After mutating server state through a soft delete, the recipe paths
  also ping a dedicated `notify` endpoint to nudge cross-client sync propagation.

- **Hard delete (irreversible, recipes).** Emptying the trash POSTs a
  byte-identical full recipe with **both** `in_trash: true` **and**
  `deleted: true`, the exact shape the desktop client emits on "empty trash." The
  critical, non-obvious detail: this body **echoes the recipe's stored `hash` and
  `created` verbatim** and must _not_ recompute the hash. Paprika validates the `deleted`
  transition against the server-side stored hash; a recomputed or blanked hash on
  a hard delete would be rejected. This is the single exception to the "always
  recompute the hash on write" rule below.

The grocery cross-entity operations (clearing purchased items, clearing a whole
list, moving items to the pantry) are built on the same soft-delete primitive:
they mark the affected items `deleted: true` and let the ordinary collection
upsert carry them out, rather than reaching for any special bulk-delete verb,
because no such verb exists on the wire.

### Null `aisle_uid` and the no-aisle sentinel

Several grocery-family entities carry an `aisle_uid` that the server returns as
`null` when the row has never been filed into an aisle. Null is awkward to thread
through a typed store, so on read it is coerced to an empty-string sentinel and
the stored field is always a concrete string. The aisle UID itself comes in two
shapes the schema must both accept (a long uppercase-hex identifier for
Paprika's built-in aisles and an uppercase UUID for user-created ones), which is
why the aisle UID is left deliberately unconstrained rather than brand-validated
like other UIDs. A grocery _ingredient_ that coerces to the no-aisle sentinel
carries no useful aisle memory at all, so the sync layer drops those rows instead
of storing empty catalog entries.

## Photo upload: a three-request choreography

Attaching a photo is the most elaborate sequence on the wire, and it cannot be
collapsed into one request because Paprika models a photo as **two distinct
images with two distinct UIDs**: a small thumbnail bound to the recipe's `photo`
field, and the full-resolution image which _is_ the standalone Photo entity
(`photo_large`). Replicating the desktop client means three POSTs in order:

1. **Recipe POST carrying the thumbnail.** The recipe is updated so `photo` and
   `photo_large` point at the two image filenames and `photo_hash` is set to the
   SHA-256 of the thumbnail bytes; the thumbnail itself rides along as a raw
   `image/jpeg` multipart part (`photo_upload`), _not_ gzipped and _not_
   base64-encoded, unlike the JSON `data` part beside it.
2. **Photo POST carrying the full image.** The Photo entity's metadata goes up
   at the singular photo URL, with the full-resolution bytes as the raw
   `photo_upload` part.
3. **Recipe re-POST (confirm).** The recipe is posted a second time as the
   client's confirmation step, matching the captured sequence.

Two findings make this tractable rather than fragile. First, a photo attach does
**not** trigger server-side hash validation (the `deleted`-tombstone path is the
only place the recipe hash is validated), so the recipe hash here only needs to be
_self-consistent_, not server-blessed. Second, Paprika stores client-supplied
content hashes **verbatim**: the Photo entity's `hash` is simply the SHA-256 of
the bytes we upload, so we control it end to end. Images are normalized to JPEG
before they reach the client, which takes already-prepared buffers and computes
the digests.

Deleting a photo is the soft-delete pattern again: a **data-only tombstone** (no
image part) at the singular photo URL with every field echoed, `deleted: true`,
and the _original_ create-time hash preserved.

### Reading a photo's bytes back

The bytes are not in the catalog. The collection read (`GET /sync/photos/`) returns
only the six-field metadata rows (`uid`, `recipe_uid`, `filename`, `name`,
`order_flag`, `hash`) — no URL. To fetch the image, read the **singular** photo URL
(`GET /sync/photo/{uid}/`), whose response carries a short-lived **presigned S3
`photo_url`** (`…uploads.paprikaapp.com…`) pointing at the full-resolution bytes;
fetch that URL for the image itself. This two-step shape is not in our captured
corpus (the captures cover the write path only); it is reconstructed from the
public reverse-engineering of the API and is exercised in tests with hand-rolled
handlers rather than a HAR fixture. The recipe-level `photo_url` field is distinct
and is empty for uploaded photos — which is exactly why uploaded photos need this
per-photo read to surface at all (#419). The proxy resource that consumes it lives
in `src/domains/recipe/resources/photo-resource.ts`; see `docs/architecture.md`.

### Grocery ingredient auto-creation

The capture corpus also revealed that the grocery ingredient catalog is not a
pre-populated reference table. When the client adds grocery items, it
_simultaneously_ upserts matching `GroceryIngredient` entries in the same request
cycle; the catalog grows as a side effect of adding items rather than existing
ahead of them. Write tooling that adds grocery items therefore has to author the
companion ingredient records itself; nothing on the server backfills them.

## The local recipe content hash

This is the deepest piece of reverse-engineered knowledge in the project, and it
is worth being precise about its status: it is **hard-won knowledge, not a design
decision.** We made no choice here. The shipped framework already encodes a single
correct answer, and our job was to discover it exactly. There were no alternatives
to weigh; matching Paprika's own hash is the only correct behavior, which is why it
lives here as knowledge rather than as an ADR.

### Why we compute it at all

Every recipe carries a content `hash`. Cross-client sync uses that hash to decide
whether a recipe changed: if our write sends a `hash` that does not match what the
content actually hashes to (for instance, a blank hash), the next sync round
treats the recipe as dirty and re-fetches it to reconcile: wasteful churn on
every single write. To write a recipe _cleanly_, the client must stamp the same
hash Paprika's own framework would compute for that content. So we reimplemented
the framework's hashing locally.

### What the algorithm is

The hash mirrors `Recipe.hashValues` in the shipped `Paprika.framework`. In
shape: an **uppercase hex SHA-256** over a JSON **array** (not an object) of the
recipe's fields **sorted alphabetically by their wire key**, serialized the way
Apple's Foundation serializer would: compact, UTF-8, and with forward slashes
escaped (the one place Node's stringifier diverges from Foundation).[^slash] The
per-field rules that make it match exactly:

- **The hash field is blanked** to `null` before hashing; it is self-referential.
  Feeding a stored hash back into the computation is precisely why an earlier
  blank-hash approach never matched.
- **`in_trash` and `deleted` are pinned false.** The hash is deliberately
  _trash-independent_: Paprika echoes the stored hash unchanged across trash and
  hard-delete flips, so the content hash must depend only on content, never on
  trash state. (This is what lets a pure trash toggle recompute to the _same_
  hash while a content edit that also trashes in one call still produces a fresh,
  detectable hash.)
- **`status` is excluded** from the hashed fields entirely.
- **Categories are emitted as a nested array of their UIDs, sorted ascending by
  raw code-unit byte order**: the framework canonicalizes its category set to
  this order regardless of insertion order, so we must too.
- A handful of fields (image/photo references, scale) are emitted **as-is**
  (`null` stays `null`, `""` stays `""`) while ordinary empty string fields are
  normalized to `""`, matching how the framework stores them.

### How parity is kept honest

A transcribed spec rots. So instead of trusting the prose above, the port is
pinned to **authoritative framework output**: a generator on a Mac with Paprika
installed loads the real framework, calls its actual `Recipe.hashValues` getter
over synthetic recipes spanning the edge cases (zero/one/many categories,
mixed-case UIDs, empty-vs-null fields, forward slashes, non-ASCII), and emits the
expected hashes as committed fixtures. The TypeScript implementation is tested
against those. Re-running the generator after a Paprika upgrade is the drift
check: **no fixture diff** means the algorithm is unchanged; **a fixture diff**
means Paprika changed its hashing and the port must be re-derived to match.

### Where it is applied

The hash is stamped at exactly one chokepoint on the write side, so it cannot
drift across the many call sites that save recipes. Every recipe write recomputes
the content hash there, **with the single exception of the hard-delete tombstone,
which echoes the stored hash verbatim** for the server-side validation reason
described above. Because the photo upload changes hashed fields (the photo
references), it stamps a fresh hash too. In each case the stamped recipe is what
gets committed locally, so the cached recipe and the posted body always agree on
the hash.

### Legacy pre-2020 hash provenance

Recipes created by very old client versions may carry a hash computed by an
earlier scheme. This needs no special-casing: the moment such a recipe is saved
again, it is re-hashed under the current algorithm and converges. There is no
migration to write and no compatibility branch to maintain; the next write fixes
it.

## References

- [`docs/wire-captures/README.md`](wire-captures/README.md) — the sanitized HAR
  corpus, typed-fixture access, and capture/regeneration workflow (the literal
  ground truth this document narrates).
- [`scripts/recipe-hash-fixtures/README.md`](../scripts/recipe-hash-fixtures/README.md)
  — the framework-parity generator and drift-check procedure for the content hash.
- `src/paprika/CLAUDE.md` — the client contract (per-method endpoints, schemas,
  resilience, and sync semantics).
- Issues #167 / #191 (recipe content-hash reverse-engineering), #125 (server-side
  `deleted`-vs-hash validation), #158 (startup-auth resilience).
- The shipped `Paprika.framework` `Recipe.hashValues` getter — the external
  specification the local hash mirrors.

[^slash]:
    This is the kind of detail that costs an afternoon. Every field can
    match, every type can match, and the digest still comes out wrong because one
    serializer wrote `\/` where the other wrote `/`. A single escaped byte is the
    difference between a clean write and re-fetching the recipe on every sync,
    forever.
