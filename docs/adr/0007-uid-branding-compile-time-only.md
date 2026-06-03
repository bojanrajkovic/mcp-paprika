# ADR-0007: UID branding stays compile-time only

**Status:** Accepted (2026-06-03)
**Last verified:** 2026-06-03
**Resolves the runtime-branding follow-up deferred by:** [ADR-0005](0005-composition-modules-and-identifiers.md)

## Context

ADR-0005 branded every foreign key through the `src/ids.ts` leaf and recorded the branding as **compile-time kind-safety only**: at runtime `z.string().brand()` is a phantom type, so a wrong-kind UID "can never be caught at runtime — the compile-time brand is the only guard that exists." It deferred two separable runtime questions to [#202](https://github.com/bojanrajkovic/mcp-paprika/issues/202):

1. **Shape-carrying brands.** Could a UID carry its own kind (a `recipe_…`-style or otherwise self-describing identifier) so that a cross-entity UID fails to _parse_, making the brand a runtime guard rather than a phantom?
2. **Non-emptiness.** The `*UidSchema`s were inconsistent — 7 of 12 carried `.min(1)`, 5 did not — and several foreign keys used the empty string as a "no reference" sentinel, so the obvious "standardize on `.min(1)`" was not safe without first reconciling how an _absent_ FK is spelled.

Both questions turn on one fact about this system: **the UID namespace is Paprika's, not ours.** This server projects an eventually-consistent third-party backend; it does not own the store or the identifier mint. That fact was tested directly against the live Cloud Sync API, and the wire contract it revealed is pinned in [`docs/wire-format.md`](../wire-format.md) ("UID shapes: what the server mints and what it accepts"). The load-bearing findings:

- **The server validates the shape of client-minted new UIDs.** It accepts only a canonical `8-4-4-4-12` hex UUID structure (case-insensitive, hex-only); anything else — a textual prefix, a trailing suffix, hyphen-free hex, a length-36 non-UUID — is refused with an `Invalid uid` error. A self-describing `recipe_…` identifier cannot be written at all.
- **A large share of the existing corpus is server-minted in shapes a client cannot reproduce.** Recipes and categories carry compound `<uuid>-<n>-<hex>` identifiers; built-in aisles, meal types, and the default grocery list carry 64-hex hyphen-free identifiers. The reference catalogs in particular are **system-seeded** — un-re-mintable (the write validator rejects their shape) and un-deletable (the app re-seeds them).
- **Even a full re-tag could not make every UID self-describing.** Because the system entities cannot be re-minted, a "every UID encodes its kind" invariant is unreachable by construction — and the desktop app stamps a fresh, untagged UID on every write from any device, so any tagged invariant decays the moment the collection is touched outside this server.

So runtime _kind_ enforcement is not available to us: it would have to reject the very identifiers the backend issues. Non-emptiness, by contrast, is available and worth having — no legitimate UID is empty.

## Decision

**1. UID branding stays compile-time only. There is no runtime kind enforcement, and no shape-carrying or kind-tagged identifier scheme.** The phantom brand from ADR-0005 already prevents the realistic failure — a `RecipeUid` assigned where a `MenuUid` is expected — at compile time. The residual runtime risk (a raw string entering the typed world without passing the kind's schema) is small and lives at boundaries that already validate, and it cannot be closed against a corpus the backend mints in shapes we neither control nor can reproduce.

**2. Runtime non-emptiness _is_ enforced, with absence made explicit.** Every brand's primary-key schema carries `.min(1)`. An absent foreign key is spelled explicitly at the field rather than smuggled through a min-less twin of the brand:

- a nullable FK is `XUidSchema.nullable()` (`null` = none): `meal.recipeUid`, `menuItem.menuUid`, `menuItem.recipeUid`, `category.parentUid`;
- the grocery family's "no aisle" reference keeps its empty-string sentinel, now a named schema in `ids.ts` — `NoAisleRef = z.literal("").brand("AisleUid")`, `AisleUidRef = AisleUidSchema.or(NoAisleRef)` — used wherever an `aisle_uid` coerces through `NO_AISLE_UID`;
- a required FK confirmed never-empty against the wire captures is the strict schema directly: `photo.recipeUid`, `groceryItem.listUid`, `menuItem.typeUid`.

This deletes the three `*RefSchema` exports (`RecipeUidRefSchema`, `MenuUidRefSchema`, `GroceryListUidRefSchema`) that ADR-0005's Phase 3 introduced as a no-op compatibility shim, and folds the PK-vs-FK distinction back into one brand per kind plus an explicit absence form. `src/ids.test.ts` is kept and rewritten to lock the new invariants (PKs reject `""`; `AisleUidRef` accepts it; nullable FKs accept `null`).

The empty-string sentinel is kept rather than collapsed to `null` deliberately: the wire returns `aisle_uid: null` and the read transform already coerces it to `""`, so naming the sentinel preserves the existing convention and the [#76](https://github.com/bojanrajkovic/mcp-paprika/issues/76) guarantee that one malformed row cannot abort a sync, without churning every `aisleUid` reader.

## Alternatives considered

- **Shape-carrying textual brand (`recipe_<uuid>`).** Rejected: the server refuses any UID that is not canonical hex on write, so such an identifier can never be stored, and the existing corpus is entirely un-prefixed, so a strict read schema would reject all of it.
- **Kind-tagged UUID (reserve hex nibbles, e.g. `cafe…`, as a kind marker).** Technically accepted by the validator and cheap on entropy (a four-nibble tag leaves 106 of 122 random bits), but pointless as a guard: the corpus is untagged and the system entities cannot be tagged, so a read-time kind check would either reject the legitimate corpus (strict) or fire for almost nothing (lenient). It also duplicates a guarantee the type system already gives, and invites code that wrongly assumes a tag is present on app-minted entities.
- **Re-tag the whole collection to make the invariant reachable.** Rejected: high blast radius on irreplaceable data (every primary-key entity re-created under a new UID — there is no rename verb on the wire — with foreign keys re-pointed and the recipe content hash, which folds in the UID, recomputed, across a live multi-device account), for a payoff the compile-time brand already provides — and the invariant would _still_ be unreachable, because the system entities cannot be re-minted.
- **Collapse `.min(1)` off every brand (one `z.string().brand()` per kind), deleting the split without enforcing non-emptiness.** This was the originally-sketched #202 path. Rejected in favor of the stronger invariant: UIDs are server- or `crypto.randomUUID()`-issued and never legitimately empty, so enforcing non-emptiness costs nothing and documents the intent, where dropping it would silently accept a malformed empty UID as valid.

## Consequences

- One brand per kind, all `.min(1)`; FK absence is visible at the field (`.nullable()` or `AisleUidRef`). The `*RefSchema` indirection is gone.
- The brand remains a phantom: it constrains the type checker, not the parser. Reviewers and future ADRs should not expect a cross-kind UID to fail at runtime.
- The decision is contingent on bridging a backend whose namespace we do not own. Were this server to own its own persistence and identifier mint rather than projecting a third-party backend, the namespace and corpus would be uniform and ours, and shape-carrying identifiers could be reconsidered at that point — a question for that future, not this one.
