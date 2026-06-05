# CLAUDE.md — AI Agent Index

Last verified: 2026-06-04

> **Keep this file lean.** It is the project-wide pointer index for agents. Detailed docs live under `docs/`; the human dev workflow lives in `CONTRIBUTING.md`; the rules that govern the doc system live in `docs/documentation-system.md`. When you change a feature, update its architecture doc or the relevant directory `CLAUDE.md`, not this index.

## Project

**mcp-paprika** — an MCP server for the Paprika recipe manager. Two transports, selected by `MCP_TRANSPORT`: **stdio** (default; unauthenticated local pipe for Claude Desktop/Code, Cursor, mcp-cli) and **Streamable HTTP** (remote clients; OAuth 2.1 + OIDC delegation). See `docs/architecture.md` for the shape and `docs/adr/` for the decisions behind it.

## Tech stack

TypeScript 6 (ESM, `@tsconfig/strictest`) on Node.js 24 (mise-managed), pnpm via corepack. MCP via `@modelcontextprotocol/sdk`; HTTP via hono; validation via zod; errors via neverthrow; resilience via cockatiel; logging via pino; image normalization via sharp. The full dependency set lives in `package.json` and is not re-listed here. Ships as a distroless container (3-stage Dockerfile).

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format`. Full reference and dev setup: `CONTRIBUTING.md`.

**Fresh git worktree:** run `pnpm install --ignore-scripts` once before anything else, or lefthook's `prepare` step (`lefthook install`) makes every `pnpm` / `git commit` / `git push` fail (mechanism in `CONTRIBUTING.md`).

The source tree is a typed composition kernel over self-registering domain modules (ADR-0009).

- `src/index.ts`, `src/transport/` — transport dispatch and the stdio / Streamable-HTTP entry points; each transport assembles the kernel `Infra` and calls `buildKernel`.
- `src/kernel/` — the composition substrate: `defineModule`/`register`, the declaration-merged `DomainRegistry`, `buildKernel` (dependency-ordered construction, the sync driver, boot phases), and the generated module barrel. See `src/kernel/CLAUDE.md` and `docs/adr/0009-domain-isolated-tool-modules-kernel.md`.
- `src/domains/<domain>/` — one directory per cohesive domain (recipe, grocery, menu, meal, meal-type, pantry, aisle, meal-planner): its `module.ts` + `api.ts`, its defining entity's `types.ts`/`store.ts`/`disk.ts` at the root, any additional owned entity in an `<entity>/` subdir, and co-located `tools/`, `resources/`, `syncs/` with tests beside them. See `src/domains/CLAUDE.md`.
- `src/features/<feature>/` — kernel modules that are optional features, not data domains: semantic search (discover) and AI photo generation (photo-gen). See `src/features/CLAUDE.md`.
- `src/shared/` — the few genuinely cross-cutting tool helpers: the MCP `textResult` envelope + the uid-or-text lookup abstraction (`tools.ts`), and the SSRF-guarded image fetch (`photo-fetch.ts`). See `src/shared/CLAUDE.md`.
- `src/server/` — the composition root's remaining pieces: the `Notifier` abstraction, `buildInfraBase` + `buildBrandedServer`, the background sync loop, and the cross-entity index-event seam. See `src/server/CLAUDE.md`.
- `src/paprika/` — the Paprika cloud-sync HTTP client and `syncReplaceAllEntity` (the shared per-module reconcile helper). Wire formats: `docs/wire-format.md`.
- `src/ids.ts` — the shared branded-UID leaf every domain imports for kind-safe foreign keys; its header explains the FK-reference vs primary-key schema split.
- `src/entity/` — the shared `EntityStore` base class. See `src/entity/CLAUDE.md`.
- `src/cache/` — the persistence layer: per-entity `DiskCache`s (plus `DiskCacheRoot` and the auth-only `buildAuthCaches`), keeping the in-memory stores warm across restarts. See `src/cache/CLAUDE.md`.
- `src/auth/` — the OAuth 2.1 authorization-server surface; loaded only under the HTTP transport.
- `src/utils/` — config (Zod schema), logging, resilience, dates, XDG paths.
- `scripts/`, `docs/wire-captures/`, `Dockerfile`, `.github/workflows/` — tooling, sanitized wire captures, container build, CI.

For per-directory detail, read that directory's `CLAUDE.md`. For current counts and inventories (tools, stores, fields, env vars), read the source (the `module.ts` registrations under `src/domains/` + `src/features/`, the Zod schemas, `package.json`); this index does not enumerate them.

## Documentation map

| Topic                                   | Home                           |
| --------------------------------------- | ------------------------------ |
| How it works (current architecture)     | `docs/architecture.md`         |
| Decisions, and why                      | `docs/adr/`                    |
| Reverse-engineered Paprika wire formats | `docs/wire-format.md`          |
| Configuration (env vars, paths)         | `docs/configuration.md`        |
| HTTP transport config                   | `docs/http-transport.md`       |
| OAuth 2.1 / OIDC config                 | `docs/oauth-configuration.md`  |
| Tools reference                         | `docs/tools/`                  |
| Embedding providers                     | `docs/embedding-providers.md`  |
| Releasing                               | `docs/releasing.md`            |
| Doc-system governance                   | `docs/documentation-system.md` |
| Human dev workflow                      | `CONTRIBUTING.md`              |

## Invariants

- **Conventional Commits**, enforced by the `commit-msg` hook (`@commitlint/config-conventional`); atomic commits. See `CONTRIBUTING.md`.
- **Three-tier hooks** — pre-commit (oxfmt + oxlint), commit-msg (commitlint), pre-push (typecheck + test); CI re-runs them. Don't bypass.
- **ESM with `.js` import extensions**, strict TypeScript, `readonly` by default.
- **neverthrow in the core** — `Result` with `.match()` / `.andThen()`; never `.isOk()` / `.isErr()`; never throw in core logic. Exceptions live only at infra boundaries.
- **No `console`** — stdout is the MCP wire in stdio mode; use `ctx.log`. The `no-console` oxlint rule enforces it. Two documented `process.stderr.write` exceptions: `src/index.ts` and `src/transport/stdio.ts`.
- **Slim directory `CLAUDE.md`** — each one points at its canonical doc plus reactively-accreted Sharp edges; it is not a mini architecture doc. See `docs/documentation-system.md`.
- **`AGENTS.md` symlinks** — every `CLAUDE.md` has a sibling `AGENTS.md` symlink, so agents that look for `AGENTS.md` get the same guidance; the symlink keeps the two identical.
- **Reference content is read from source, never enumerated in prose** — counts, store lists, field tables, and env dumps live in the registry, the Zod schemas, and `package.json`, not here. See `docs/documentation-system.md`.

## Planning and design

When planning or designing a change here:

1. **Ground yourself in the docs and code, and verify before you assert.** Read the relevant directory `CLAUDE.md`, `docs/architecture.md`, the ADRs, and the actual source before proposing. A section heading, your memory, or a subagent's framing is not evidence; grep or read to confirm a claim before you build on it.
2. **Gather the task's context up front.** Pull what is already true in the codebase, the constraints, and the prior decisions into the planning context early, instead of rediscovering them mid-build.
3. **Ask clarifying questions freely, and name your assumptions out loud.** When scope, direction, or a preference is even slightly unclear, ask: a thorough `AskUserQuestion` pass beats a confident wrong guess. When you do have to assume, say so.
4. **Pin "done" and "out of scope" before designing.** Name the deliverable, the success criteria, and what you are explicitly _not_ doing. This is the line between a plan and a brainstorm, and the thing that keeps a change from sprawling.
5. **Brainstorm two or three alternatives: don't ship the first idea**, each with its hazards and its fit to what already exists. Hold two forces in tension: prefer the smallest change that fits the existing patterns (don't build a framework for a future that may never arrive), _and_ invest in the right abstraction when the repetition is real or clearly coming. The discriminator is demonstrated-vs-speculative: `EntityStore` and the per-entity disk caches were _extracted as refactors_ (consolidating plumbing already duplicated across stores, and shaped so the next entity is nearly free), which is why a new entity's store later just `extends EntityStore`. When you do extract, design it to generalize cleanly; when you lack the evidence, copy first and abstract on the third.
6. **Be adversarial: attack your own proposal.** Hunt the failure mode, the edge case, the thing that breaks under concurrency, a hostile input, or a partial sync. A design no one tried to break is untested.
7. **Record decisions with real alternatives as ADRs, at decision time.** If a choice had alternatives someone might later question, write the ADR while the reasoning is fresh; backfilling it later costs more and loses detail. See `docs/documentation-system.md` for which decisions are ADR-worthy.
8. **Update the docs as part of the change, not after.** The affected `docs/architecture.md`, the directory `CLAUDE.md` sharp edges, and any ADRs are part of "done": a change whose docs still describe the old world isn't finished.
9. **Know who the tool surface is for: an LLM agent acting for a non-technical user, not a developer.** Optimize the **tool surface** to minimize the agent's chance of getting it wrong — hide fields with no meaningful agent choice, prefer discriminated unions over stale enums, default to human intent, give errors a remediation hint; and when external MCP guidance conflicts with an established local precedent, local convention wins (agents pattern-match within one server, not across them). This is scoped to the surface — the engine behind it (kernel, stores, sync) is held to the opposite, maintainability-first bar. See [ADR-0004](docs/adr/0004-tool-vs-resource-classification.md) and [ADR-0008](docs/adr/0008-tool-surface-command-language.md).
