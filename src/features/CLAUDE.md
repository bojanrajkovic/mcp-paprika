# Feature Implementations

## Purpose

Three feature modules on the kernel — kernel modules that are optional features, not data domains. `discover/` (semantic search) and `photo-gen/` (AI photos) are each composed in a `.state` factory and opt-in on config: the semantic-search stack (`EmbeddingClient` → `VectorStore` → the owned `JsonVectorIndex`) and the photo-generation stack (`PhotographyClient` + SSRF-hardened image fetch). An unconfigured feature builds a `null` component; the kernel registers their tools (`discover_recipes`, `generate_recipe_photo`) **unconditionally**, and the feature gate lives inside the handler, which declines with a clear not-configured result when its component is `null` (ADR-0009 §5; since R1, `discover_recipes` returns that as an `isError` redirect to `search_recipes`).

`widgets/` is the odd one out: it owns no entity and reads no config, and serves the prebuilt `ui://widget/{name}` HTML resources a host renders in a sandboxed iframe (ADR-0019). It registers a single **app-only** tool — `record_widget_timing`, the widget render-timing sink (0b), hidden from the model's `tools/list`. Its sharp edges (the build-time-only toolchain, the boot-degrade, the path resolution) live in its own `CLAUDE.md`.

## Key References

- [ADR-0003: Vendored JSON vector index](../../docs/adr/0003-vendored-json-vector-index.md) — why the index is an owned rewrite of Vectra's slice (footprint + correctness), and the norm/boundary/ordering commitments; its 2026-06-05 note retires the "vendored" framing (owned code returns `Result` — ADR-0014).
- [docs/architecture.md](../../docs/architecture.md) — Semantic Discovery and Photos sections (the directions/nutrition exclusion, the re-index chokepoint, the SSRF hardening, all at a glance).
- Module-level header comments in `json-vector-index.ts`, `photography.ts`, and `../shared/photo-fetch.ts` carry the per-decision rationale.
- Method signatures, error classes, config fields, and resilience tuning numbers live in the `.ts` source and Zod schemas — not duplicated here.

## Sharp edges

**Norm is a cache, never trusted (`JsonVectorIndex`).** The per-item norm is recomputed from the vector on every upsert and load; the persisted value is discarded, so a changed vector can never leave a stale norm behind. Why (the `vectra` upsert-path bug it closes, the load-compatible on-disk subset): the `json-vector-index.ts` header + ADR-0003.

**Corruption routes to recovery, not to `NaN` scores.** Non-empty / all-finite / one-dimension / non-zero-norm are enforced on insert AND load; a violation `err`s into `VectorStore`'s backup-and-recreate recovery rather than silently producing `NaN` cosine scores. The comparator and per-query guard rationale live in the `json-vector-index.ts` header (ADR-0014: owned code errs on corruption).

**Total ordering, ties broken by id.** Query results sort by descending score with ties broken deterministically by id ascending; never the `NaN`-tolerant sort `vectra` performed. Don't "optimize" the comparator into a partial order; the determinism is the point (also recorded in ADR-0003).

**Changing the embedding text format MUST bump `EMBEDDING_SCHEMA_VERSION`** — otherwise old vectors silently coexist with the new format instead of triggering a full re-index on next startup. What `recipeToEmbeddingText` covers (and why directions/nutrition are deliberately excluded, so editing cooking steps doesn't churn the index) is in `docs/architecture.md` (Semantic Discovery) + the `embeddings.ts` source.

**The kernel re-index seam covers what sync can't (#177).** discover has no dependency edge into recipe, so recipe/category writes emit on `infra.indexEvents` and discover's `index` hook re-embeds — covering the two cases sync misses: a tool-written recipe's UID is pending so the recipe-diff filters it out, and a category rename changes no recipe hash so sync never re-fetches its recipes. Don't drop an emit assuming sync will cover it; it won't. Emits are fire-and-forget and must never throw, and `VectorStore` serializes writes via a mutex so unawaited concurrent emits are safe. Mechanism: `docs/architecture.md` (re-index chokepoint) + the `recipe/module.ts` / `recipe-sync.ts` source.

**The `index` boot hook self-heals down-time drift and latches a retry on a startup outage (#177).** It runs after the initial `syncOnce()` (stores warm), re-embedding whatever drifted while the server was down. The latch is the gotcha: a transient embeddings outage at boot sets `reconcilePending`, drained by the next `recipe-changed` cycle — so don't assume the boot reconcile is all-or-nothing. Detail in `discover/module.ts`.

**Photo egress is SSRF-hardened — every server-side image fetch goes through `fetchImageBytes`, never a raw `fetch`.** Two warnings a future editor will trip on: it must import `fetch` from **undici**, not Node's global `fetch` (the global's bundled undici rejects this dispatcher with `UND_ERR_INVALID_ARG`), and `upload_recipe_photo` exposes **no `file_path`** source by design (a server-side path read would be LFI/SSRF). The layered guard itself — unicast-only `ipaddr.js` check + DNS-rebinding-safe `ssrfLookup` dispatcher + blocked redirects — lives in `../shared/photo-fetch.ts`'s header, summarized in `docs/architecture.md`.

**Generated-photo previews evict-oldest, not reject-on-full (`GeneratedImageStore`).** Unlike the auth TTL stores (where evicting an in-flight entry is an attack vector), dropping a stale throwaway preview is harmless, so the ring buffer overwrites the oldest when full. Single-use and race-safe: `upload_recipe_photo` `consume`s the token (synchronous delete before any `await`, so two concurrent calls can't both attach the same preview), then `restore`s it ONLY on a pure-validation failure (wrong `recipe_uid`, before any write). It must NOT restore after `attachPhotoToRecipe`, which uploads to Paprika before the local commit; restoring there could let a retry duplicate an already-uploaded photo. A validated-but-failed attach loses the preview (regenerate); that's the duplicate-safe trade.

**The resilient clients are `Result`-native; only the cockatiel-governed `execute` closures still throw (form #3, conformance-pinned).** `EmbeddingClient`, `PhotographyClient`, and every `VectorStore` op return `ResultAsync` (ADR-0014); the throw protocol ends at each client's `fromPromise` edge — don't let a throw escape it. Error classes (`CircuitOpenError`, the per-client `*APIError`) are in `utils/errors.js` + the source. (`VectorStore`'s write mutex is covered in the re-index-seam edge above.)
