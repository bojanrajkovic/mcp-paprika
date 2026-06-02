# Architecture

Last verified: 2026-06-01

mcp-paprika bridges the Paprika recipe manager's cloud API to MCP clients. It keeps a local cache of the user's library, syncs it in the background, and exposes recipes, the pantry, grocery lists, meal planning, menus, and optional semantic search and AI photo generation as MCP tools and resources.

This doc is the conceptual landing for how the system fits together — the shape and the _why_. Current inventories (which tools exist, which stores, which config keys, on-disk layout) are read from the source and the per-directory `CLAUDE.md` files, not transcribed here; see the documentation map in the root `CLAUDE.md`. Decisions with weighed alternatives live in `docs/adr/`.

## One composition root, two transports

The business logic — every tool and resource, the sync engine — is written once and is transport-agnostic. What differs between a local CLI client and a remote network client is only the framing, the number of concurrent sessions, and whether identity must be proven. That separation is enforced by the composition root in `src/server/` (see `src/server/CLAUDE.md`):

- **`AppContext`** is process-wide, heavyweight state, built once: the Paprika client, the disk cache, every in-memory store, the optional vector and photography clients, the logger, the optional auth runtime, and the `Notifier`. It has **no `server` field** — nothing process-wide may reach "the server," which is what makes process-wide state independent of how many sessions exist.
- **`SessionContext`** is `AppContext` plus the one `McpServer` for a session. It is what every handler receives — one for the whole process under stdio, one per active session under HTTP.
- The **`Notifier`** is the seam that lets mutation code stay transport-blind: callers push resource-list-changed and logging notifications through `ctx.notifier` rather than reaching a server, and the implementation (single-server vs. broadcast) is chosen by transport.

The two transports (`src/transport/`) are selected at startup by `MCP_TRANSPORT`. **stdio** is the default: a local, unauthenticated pipe where stdout _is_ the protocol, so stray output corrupts the wire. **Streamable HTTP** is a long-lived network service with per-session state, an OAuth surface, a readiness/liveness probe, and a Kubernetes-aware graceful drain. Both run the one composition root unchanged. See [ADR-0001](adr/0001-two-transports-and-composition-root.md).

## Caching and sync

Every Paprika entity family lives in two layers: an in-memory store that is the session's source of truth, backed by an atomic-write per-entity disk cache. Tools never touch the filesystem — they query the store, which is hydrated from disk at startup and kept fresh by background sync. That split keeps disk I/O off the hot path and keeps tool code trivially testable, and the disk layer makes the server immediately usable on restart (the cache is warm before the first sync returns). See `src/cache/CLAUDE.md` and `src/cache/disk/CLAUDE.md`.

Sync (`src/paprika/`) runs once on startup and then optionally polls. It is **never-throws**: a failed cycle is logged and the loop continues. Two patterns coexist by entity:

- **Diff-and-fetch** (recipes). Paprika's sync endpoint returns only `{uid, hash}` pairs. The cache diffs those content hashes against what it holds and fetches full data only for what changed — an incremental sync of a 500-recipe library touches the few recipes that actually moved, in one list call plus a bounded number of detail fetches. This depends on the locally-computed recipe content hash being stamped on every write so cross-client edits are detectable; that algorithm is reverse-engineered and documented in [`docs/wire-format.md`](wire-format.md).
- **Replace-all** (categories and the other reference/collection families). Small enough to refetch wholesale.

After a cycle that changed an entity with a resource surface, sync fans a resource-list-changed notification through the `Notifier`; families with no resource surface (e.g. pantry) emit none.

## Semantic search

Semantic discovery is optional — it registers the `discover_recipes` tool only when embedding config is present. An OpenAI-compatible embedding client turns each recipe into an embedding (over name, description, categories, ingredients, and notes — **directions and nutrition are deliberately excluded** so editing cooking steps doesn't churn the index) and stores the vector in a vendored, file-backed cosine index. Re-indexing is hash-tracked and funneled through one chokepoint so every local write and category rename re-embeds only what changed — typically zero embedding calls on an unchanged sync. See `src/features/CLAUDE.md` and [ADR-0003](adr/0003-vendored-json-vector-index.md).

## Photos

The server reads and syncs recipe photos and can generate new ones. AI generation (`generate_photo`) is opt-in (registered only when an image-generation client is configured) and produces a styled photo through an OpenRouter image model, normalized with sharp. Any server-side image fetch is SSRF-hardened (unicast-only address guard plus a DNS-rebinding-safe dispatcher), because the URL can be model- or user-influenced. See `src/features/CLAUDE.md`.

## Authentication

Under stdio there is no auth surface — the OS process boundary is the trust boundary. Under HTTP the server is a full OAuth 2.1 authorization server toward MCP clients while delegating identity to one operator-configured upstream OIDC provider, minting its own opaque tokens and admitting only an allowlisted set of users. The entire `src/auth/` surface loads only when the transport is HTTP. See [ADR-0002](adr/0002-oauth21-oidc-delegation.md) and `src/auth/CLAUDE.md`.

## Cross-cutting concerns

**Logging.** One process-wide pino logger lives on `AppContext`; components take children scoped by name. A credential-redaction policy strips secrets, and records at or above the notify level fan out to connected MCP clients through the same `Notifier` seam. The bootstrap is order-sensitive (the notifier is built first around a deferred getter so startup records have somewhere to go before the server exists); `src/server/CLAUDE.md` and `src/utils/CLAUDE.md` carry the details.

**Resilience.** The Paprika client and the embedding/photography clients share one cockatiel executor: exponential-backoff retry on transient HTTP failures plus a consecutive-failure circuit breaker. Recipe detail fetches run under a bounded, configurable concurrency so sync stays courteous to the API. Startup authentication is retried but deliberately not circuit-broken (a one-shot path where a real credential rejection should fail fast). The tuning values are config, not prose — see `docs/configuration.md` and `src/utils/resilience.ts`.

**Error handling.** The functional core uses neverthrow `Result<T, E>` and never throws; infrastructure that wraps exception-throwing libraries (cockatiel, the file-backed index) throws and is caught at system boundaries (the never-throws sync loop, the discover feature's isolation handler, the tool handlers). This two-strategy split is deliberate: pure logic stays composable and total, while the messy edges are contained where they happen.

## Key decisions

The decisions with weighed alternatives are recorded as ADRs: two transports over one composition root ([0001](adr/0001-two-transports-and-composition-root.md)), OAuth 2.1 with OIDC delegation ([0002](adr/0002-oauth21-oidc-delegation.md)), the vendored vector index ([0003](adr/0003-vendored-json-vector-index.md)), and the tool-vs-resource classification ([0004](adr/0004-tool-vs-resource-classification.md)).

A few smaller choices shape the code without rising to an ADR:

- **In-memory stores over a disk cache** keep disk I/O off the hot path and tools testable; the stable store API leaves SQLite as a future escape hatch if the in-memory working set ever stops fitting.
- **neverthrow in the core, exceptions at the boundary** (above) — a convention enforced by review, not the type system.
- **A single shared resilience executor** rather than per-client retry/breaker logic, so the policy is defined once.
- **One pino root threaded through `AppContext`**, so every component logs through the same redaction and fan-out path rather than each re-discovering "the server."
