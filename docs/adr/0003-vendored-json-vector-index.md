# ADR-0003: Vendored JSON vector index for semantic search

**Status:** Accepted (2026-06-01, backfilled)
**Last verified:** 2026-06-01

## Context

Semantic recipe discovery needs a place to store externally computed embedding vectors and serve brute-force cosine top-K queries over a personal-scale corpus — hundreds to low thousands of recipes, one user's collection. The store lives on disk so that unchanged recipes survive restarts without paying to re-embed, and it sits behind a recipe-aware wrapper that handles change detection, batching, and corruption recovery.

This decision **supersedes** the original choice recorded in the vector-store design plan, which selected the Vectra `LocalIndex` file-based vector database and wrapped it directly. That plan weighed Vectra against heavier options — a hosted vector database, an embedded SQL store, and a managed cloud vector service — and picked Vectra precisely because it was the lightest "no external server, no native bindings" option that still gave an on-disk index with the begin/commit transaction shape the wrapper wanted.

Vectra delivered the right _shape_ but the wrong _footprint and correctness profile_ in practice. Two constraints forced a rethink:

- **Footprint.** Vectra's package barrel eagerly pulls its entire transitive stack — tokenizer, an embedding-provider SDK, an RPC runtime, an NLP toolkit, an HTML parser, an HTML-to-Markdown converter — even though this codebase only ever calls the `LocalIndex` storage methods and computes its own embeddings elsewhere. That dead weight dominated the installed dependency tree and the container image for code paths that never run.
- **Correctness.** Vectra treats the persisted per-item norm as source of truth. After a vector is replaced, a stale norm can survive and silently corrupt cosine ranking. Its query path also performs a `NaN`-tolerant sort and a plain truncating write, neither of which this server's restart-and-recover expectations can rely on.

The surface this codebase actually depends on is small — roughly a transaction bracket, upsert, delete, and a top-K cosine query — and the math is elementary. That made vendoring a self-contained replacement tractable.

## Decision

Replace the Vectra dependency with a vendored, file-backed, brute-force cosine index of its own — a single module (`src/features/json-vector-index.ts`, on the order of 400 lines) implementing only the handful of methods the wrapper calls, with **no vector library** in the dependency tree. The recipe-aware `VectorStore` wrapper is unchanged in role: it composes this index with content-hash change detection, batched embedding, and corruption recovery.

The vendored index is deliberately built around three commitments:

- **Vectra-compatible on-disk format.** The index file is a subset of Vectra's `index.json` shape (a version plus a list of items, each carrying an id, a vector, a norm, and opaque metadata), and extra top-level keys Vectra wrote are ignored on load. An index produced by the old Vectra path therefore loads in place — **no re-embed migration** for already-deployed indexes.
- **Norm as a derived cache, never trusted.** The norm is recomputed from the vector on every insert and on every load, and the persisted value is discarded. A changed vector can never leave a stale norm behind — directly closing the ranking-corruption bug observed in Vectra's upsert path.
- **Boundary validation and a total ordering.** Vectors must be non-empty, all-finite, and share a single dimension; violations are treated as corruption and surface to the wrapper's recovery path rather than producing `NaN` scores. Stored items are guaranteed positive-norm (zero-norm vectors are rejected on insert and on load), so the only non-finite score can come from a zero-norm query, which is guarded once. Results sort by descending score with ties broken deterministically by id — never the `NaN`-poisoned sort Vectra performed. Persistence is crash-safe: write-to-temp, fsync the file, rename over the target, then best-effort fsync the directory, and the transaction commits to disk before swapping live in-memory state.

The index pairs with an OpenAI-compatible embedding client that supplies the vectors, and an embedding text that deliberately **excludes recipe directions** (and nutrition) so that editing cooking steps doesn't churn the index. A later refinement added an optional `minScore` cosine cutoff applied before the top-K slice, so a query with few genuine matches returns only those instead of padding the list with near-zero-similarity noise.

## Rejected alternatives

### Keep Vectra (the immediately superseded choice)

Rejected on two recorded grounds. First, footprint: Vectra's barrel eagerly loads its full transitive stack for code paths this server never exercises, and removing it collapsed the installed dependency tree (the unused Vectra barrel pulled on the order of 70 MB of transitive packages this server never executes). Second, correctness: Vectra's upsert path left a stale norm after a re-embed, which silently corrupted cosine ranking — a latent data-integrity bug in the exact operation the indexer performs on every recipe edit. Vendoring the small surface this codebase uses eliminated both at once.

### The original-decision alternatives (historical context)

The prior vector-store design plan also weighed a hosted/server-backed vector database, an embedded SQL-based store, and a managed cloud vector service against Vectra, and rejected them in favor of Vectra's no-external-process, no-native-bindings profile. Those trade-offs still hold and are _more_ decisively satisfied by the vendored index — it adds no process, no native bindings, and no library at all. They are recorded here only as the lineage of this decision; the live rejected alternative that this ADR supersedes is "keep Vectra."

## Consequences

**Positive:**

- No vector library and no native bindings in the dependency tree; the installed footprint and container image shrink to what the running code actually uses.
- Vectra-compatible on-disk format means existing deployed indexes load with no migration and no re-embedding cost.
- Correctness improves where it matters for ranking: norms can't go stale, corrupt vectors are caught at the boundary and routed to recovery, scoring uses a total order, and writes are crash-safe.
- The full vector code path is now owned in-repo, readable end to end, and directly testable — including its cosine primitives.

**Negative:**

- Brute-force cosine scans every stored vector per query. This is fine at recipe scale (hundreds to low thousands) but is not a general-purpose vector database — it would not hold up at much larger corpora, where an approximate-nearest-neighbor index would be required.
- The on-disk format and storage semantics are now this project's to maintain; a future need (different distance metric, larger scale, richer metadata queries) lands as in-house work rather than a library upgrade.
- Pinning the format as a Vectra subset carries a small amount of legacy shape (for example, a persisted norm field that is always recomputed and discarded) for the sake of zero-migration compatibility.

## References

- Module-level rationale: header comment in `src/features/json-vector-index.ts`
- Component contracts: `src/features/CLAUDE.md` (`json-vector-index.ts`, `vector-store.ts`)
- Shipped in PR #189 (vendor a minimal vector index, dropping the Vectra stack)
