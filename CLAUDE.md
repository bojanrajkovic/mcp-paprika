# mcp-paprika

Last verified: 2026-05-22

MCP server for the Paprika recipe manager. Two transports: **stdio** (default; unauthenticated local pipe used by Claude Desktop, Claude Code, Cursor, mcp-cli) and **Streamable HTTP** (used by Claude Mobile and other remote MCP clients; ships with OAuth 2.1 + OIDC delegation). Selected via `MCP_TRANSPORT=stdio|http`.

**Logging:** The process-wide pino logger lives at `app.log` (constructed inside `buildAppContext`). Components create children via `app.log.child({ component: "<flat-name>" })`. Records at or above `MCP_LOG_NOTIFY_LEVEL` (default `warn`) fan out to connected MCP clients automatically. See `src/utils/CLAUDE.md` for the full logger contract.

**Stdio note:** when running in stdio mode, `console.log` writes to stdout which is the MCP wire format. Any stray console output corrupts the protocol. Component code must use the structured logger (`ctx.log` / child loggers); the `no-console` oxlint rule enforces this. Direct `process.stderr.write` is reserved for two documented exceptions: the SIGINT/SIGTERM handler in `src/index.ts` (logger may be torn down) and the `MCP_HTTP_*` misconfiguration warning in `src/transport/stdio.ts` (emitted before `buildAppContext` runs).

## Tech Stack

- **Runtime:** Node.js 24 (managed via mise)
- **Language:** TypeScript 5.9 (extends `@tsconfig/strictest` + `@tsconfig/node24`)
- **Module system:** ESM (`"type": "module"`)
- **Package manager:** pnpm 11.1.2 (corepack-managed)
- **Key dependencies:** @modelcontextprotocol/sdk (MCP protocol), hono + @hono/mcp + @hono/node-server (HTTP transport), zod (validation), luxon (dates), dotenv (env config), parse-duration (duration parsing), env-paths (XDG directories), neverthrow (error handling), cockatiel (resilience/retry), mitt (event emitter), vectra (local vector index), jose (OIDC/JWT), hono-rate-limiter (OAuth DCR rate limiting), async-mutex (per-subcache write serialization), pino + pino-pretty (structured logging)
- **Container:** distroless `gcr.io/distroless/nodejs24-debian13:nonroot` runtime; 3-stage Dockerfile (builder → prod-deps prune → distroless)

## Commands

| Command             | Description                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`        | Compile TypeScript to `dist/`                                                                                                                                                                                                                                                                                      |
| `pnpm dev`          | Run dev server via tsx                                                                                                                                                                                                                                                                                             |
| `pnpm test`         | Run vitest test suite                                                                                                                                                                                                                                                                                              |
| `pnpm test:watch`   | Run vitest in watch mode                                                                                                                                                                                                                                                                                           |
| `pnpm typecheck`    | Type-check source (`tsc --noEmit`) and test files + fixtures (`tsc --noEmit -p tsconfig.test.json`). `tsconfig.json` excludes `*.test.ts`, `__tests__/`, `__fixtures__/`, and `*test-utils*`; `tsconfig.test.json` extends it but includes everything, with `noEmit`/no-declaration so build output is unaffected. |
| `pnpm lint`         | Run oxlint with `--deny-warnings` on `src/`                                                                                                                                                                                                                                                                        |
| `pnpm lint:fix`     | Run oxlint with `--fix` on `src/`                                                                                                                                                                                                                                                                                  |
| `pnpm format`       | Format all files with oxfmt                                                                                                                                                                                                                                                                                        |
| `pnpm format:check` | Check formatting without writing changes                                                                                                                                                                                                                                                                           |
| `pnpm prepare`      | Install lefthook git hooks (runs automatically after `pnpm install`)                                                                                                                                                                                                                                               |

## Project Structure

- `src/index.ts` — Transport dispatcher: loads config, dispatches to `startStdio` or `startHttp` based on `config.transport`, wires SIGINT/SIGTERM to the returned handle's `shutdown()`
- `src/transport/` — Transport-specific entry points: `stdio.ts` (deferred-getter notifier, sync, then `server.connect(new StdioServerTransport())`) and `http.ts` (Hono app with `GET /healthz` + `ALL /mcp`, session map, graceful shutdown that aborts SSE streams before closing the HTTP server). `startHttp` returns an `HttpTransportHandle` with the bound port (useful for tests passing `port: 0`)
- `src/server/` — Process-wide composition root: `AppContext`/`SessionContext` types, `Notifier` abstraction (`singleServerNotifier`, `broadcastNotifier`), `buildAppContext` (heavyweight shared state; constructs the pino root logger and threads it through `AppContext.log`, `AuthContext.log`, and `PaprikaClient`) and `buildMcpServer` (per-session tool/resource registration; discover tool gated on `vectorStore !== null`)
- `src/paprika/` — Paprika API client with pantry read and write support (`listPantry()`, `savePantryItem()` methods)
- `src/cache/` — In-memory stores (`RecipeStore`, `PantryStore`) plus the persistence layer at `src/cache/disk/` (`DiskCacheRoot` and per-entity subcaches)
- `src/tools/` — MCP tool definitions including read tools (`list_pantry`, `get_pantry_item`) and write tools (`add_pantry_item`, `update_pantry_item`, `delete_pantry_item`) for pantry access
- `src/resources/` — MCP resource definitions including `paprika://pantry/{uid}` resource template
- `src/features/` — Feature implementations (semantic search wiring lives here; tool registration happens in `src/server/build.ts`)
- `src/types/` — Shared type definitions including `PantryItem` and branded `PantryItemUid`; `ServerContext` is a backward-compat alias re-exporting `SessionContext` from `src/server/`
- `src/utils/` — Cross-cutting utilities: `config.ts` (with `transport`/`http`/`oauth`/`logging` schema blocks), `log.ts` (pino root logger factory with credential-redact policy and notifier fan-out stream), `xdg.ts`, `duration.ts`
- `src/auth/` — OAuth 2.1 authorization-server surface (DCR, authorize, token, revoke), OIDC upstream client, opaque-token minting + persistence, and identity allowlist. Loaded only when `MCP_TRANSPORT=http`.
- `scripts/` — Build and verification scripts (run via `npx tsx`), plus `healthcheck.mjs` (zero-dep Node script used by the Dockerfile HEALTHCHECK)
- `Dockerfile` + `.dockerignore` — 3-stage container build targeting `gcr.io/distroless/nodejs24-debian13:nonroot`; pre-creates `/data/{config,cache}` with nonroot ownership so the disk cache writes work on first run
- `.github/workflows/` — CI and PR validation workflows

## Code Conventions

### Imports and Modules

- ESM-only: use `import`/`export`, never CommonJS
- Always use `.js` extensions in relative imports (e.g., `import { foo } from "./bar.js"`)
- Prefer named exports over default exports

### TypeScript Style

- Strict mode via `@tsconfig/strictest` — no `any`, no implicit returns, no unused variables
- Use `interface` for object shapes that may be extended, `type` for unions and intersections
- Prefer `readonly` properties where mutation is not needed

### Error Handling

- Use neverthrow `Result<T, E>` for operations that can fail in the functional core
- Never throw exceptions in core business logic — return `Result.err()` instead
- Define specific error classes (e.g., `RecipeNotFoundError`) with static factory methods
- Validate inputs with Zod schemas at system boundaries
- **Always use idiomatic neverthrow patterns** — `.match()`, `.andThen()`, `.map()`, `.mapErr()`. Never use `.isOk()` / `.isErr()` imperative checks; treat `Result` as an opaque monad.

### No Console

`console.log` is banned via the `no-console` oxlint rule. In stdio transport, stdout carries the MCP wire format and any stray output corrupts the protocol. Use the structured logger (`ctx.log.child({ component: "..." })`) for diagnostics; the logger routes around stdout automatically.

## Testing

- **Runner:** vitest
- **Test location:** Colocated with source as `src/**/*.test.ts`
- **Property-based tests:** `*.property.test.ts` (using fast-check)
- **Integration tests:** `*.test.integration.ts`
- **HTTP mocking:** msw (Mock Service Worker) for intercepting fetch in tests
- **Coverage target:** ≥ 70% for new code

## Git Conventions

### Commit Format

Conventional commits: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `build`, `chore`, `revert`, `style`

Breaking changes: use `!` after type (e.g., `feat!: change API`) or `BREAKING CHANGE:` footer.

### Hooks

Git hooks managed by lefthook, activated via `pnpm install` (the `prepare` script).

- **pre-commit:** oxfmt formats staged files (auto-restages), oxlint checks staged `.ts` files
- **commit-msg:** commitlint validates conventional commit format
- **pre-push:** runs `pnpm typecheck` and `pnpm test` before push

Hooks must not be bypassed. Fix issues before committing. If you commit before running `pnpm install`, hooks will not fire.

### Pull Requests

This project squash merges PRs, using the PR body as the merge commit description. PR bodies should contain a `## Summary` section with bullet points only — no test plans, checklists, or transient verification content. Transient content like test plans, verification checklists, and progress tracking should go in a PR comment and be kept up to date as they change.

### CI

GitHub Actions run on every PR and push to `main`:

- **CI workflow** (`ci.yml`): format check, lint, security audit, build, test
- **PR title workflow** (`pr-title.yml`): validates PR titles match conventional commit format

PRs must pass all checks before merge.

## Version Sync

- `packageManager` field in `package.json` must match the pnpm version managed by corepack
- `engines.node` must match the Node.js version in `mise.toml`
- `node-version` in `.github/workflows/ci.yml` must match the Node.js version in `mise.toml`

## Boundaries

- `dist/` and `node_modules/` are gitignored — never edit
- `.env` files contain secrets — never commit
- `pnpm-lock.yaml` is auto-generated — do not hand-edit
