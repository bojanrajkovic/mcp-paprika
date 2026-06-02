# CLAUDE.md — AI Agent Index

Last verified: 2026-06-01

> **Keep this file lean.** It is the project-wide pointer index for agents. Detailed docs live under `docs/`; the human dev workflow lives in `CONTRIBUTING.md`; the rules that govern the doc system live in `docs/documentation-system.md`. When you change a feature, update its architecture doc or the relevant directory `CLAUDE.md` — not this index.

## Project

**mcp-paprika** — an MCP server for the Paprika recipe manager. Two transports, selected by `MCP_TRANSPORT`: **stdio** (default; unauthenticated local pipe for Claude Desktop/Code, Cursor, mcp-cli) and **Streamable HTTP** (remote clients; OAuth 2.1 + OIDC delegation). See `docs/architecture.md` for the shape and `docs/adr/` for the decisions behind it.

## Tech stack

TypeScript 5.9 (ESM, `@tsconfig/strictest`) on Node.js 24 (mise-managed), pnpm via corepack. MCP via `@modelcontextprotocol/sdk`; HTTP via hono; validation via zod; errors via neverthrow; resilience via cockatiel; logging via pino; image normalization via sharp. The full dependency set lives in `package.json` and is not re-listed here. Ships as a distroless container (3-stage Dockerfile).

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format`. Full reference and dev setup: `CONTRIBUTING.md`.

## Project structure

- `src/index.ts`, `src/transport/` — transport dispatch and the stdio / Streamable-HTTP entry points.
- `src/server/` — the composition root: `AppContext`/`SessionContext`, the `Notifier` abstraction, and the `buildAppContext`/`buildMcpServer` builders. See `src/server/CLAUDE.md`.
- `src/paprika/` — the Paprika cloud-sync HTTP client and the background sync engine. Wire formats: `docs/wire-format.md`.
- `src/cache/` — in-memory entity stores over the `src/cache/disk/` per-entity disk cache.
- `src/tools/` — the MCP tool surface (registered in `src/server/build.ts`). Tool-vs-resource rationale: `docs/adr/0004-tool-vs-resource-classification.md`.
- `src/resources/` — MCP resource templates (`paprika://recipe/{uid}`, grocery-list, menu).
- `src/features/` — semantic search (embeddings + the vendored vector index) and AI photo generation.
- `src/auth/` — the OAuth 2.1 authorization-server surface; loaded only under the HTTP transport.
- `src/utils/` — config (Zod schema), logging, resilience, dates, XDG paths.
- `scripts/`, `docs/wire-captures/`, `Dockerfile`, `.github/workflows/` — tooling, sanitized wire captures, container build, CI.

For per-directory detail, read that directory's `CLAUDE.md`. For current counts and inventories (tools, stores, fields, env vars), read the source — the registry in `src/server/build.ts`, the Zod schemas, `package.json` — this index does not enumerate them.

## Documentation map

| Topic | Home |
| --- | --- |
| How it works (current architecture) | `docs/architecture.md` |
| Decisions, and why | `docs/adr/` |
| Reverse-engineered Paprika wire formats | `docs/wire-format.md` |
| Configuration (env vars, paths) | `docs/configuration.md` |
| Tools reference | `docs/tools/` |
| Embedding providers | `docs/embedding-providers.md` |
| Releasing | `docs/releasing.md` |
| Doc-system governance | `docs/documentation-system.md` |
| Human dev workflow | `CONTRIBUTING.md` |
| Design plans (point-in-time journey) | `docs/design-plans/` |

## Invariants

- **Conventional Commits**, enforced by the `commit-msg` hook (`@commitlint/config-conventional`); atomic commits. See `CONTRIBUTING.md`.
- **Three-tier hooks** — pre-commit (oxfmt + oxlint), commit-msg (commitlint), pre-push (typecheck + test); CI re-runs them. Don't bypass.
- **ESM with `.js` import extensions**, strict TypeScript, `readonly` by default.
- **neverthrow in the core** — `Result` with `.match()` / `.andThen()`; never `.isOk()` / `.isErr()`; never throw in core logic. Exceptions live only at infra boundaries.
- **No `console`** — stdout is the MCP wire in stdio mode; use `ctx.log`. The `no-console` oxlint rule enforces it. Two documented `process.stderr.write` exceptions: `src/index.ts` and `src/transport/stdio.ts`.
- **Slim directory `CLAUDE.md`** — each one points at its canonical doc plus reactively-accreted Sharp edges; it is not a mini architecture doc. See `docs/documentation-system.md`.
- **`AGENTS.md` symlinks** — every `CLAUDE.md` has a sibling `AGENTS.md` symlink, so agents that look for `AGENTS.md` get the same guidance; the symlink keeps the two identical.
- **Reference content is read from source, never enumerated in prose** — counts, store lists, field tables, and env dumps live in the registry, the Zod schemas, and `package.json`, not here. See `docs/documentation-system.md`.
