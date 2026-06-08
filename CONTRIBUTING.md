# Contributing to mcp-paprika

Last verified: 2026-06-01

The human-developer workflow for mcp-paprika. Agent-facing guidance and the project-wide index live in `CLAUDE.md`; the rules that govern the documentation system itself live in `docs/documentation-system.md`.

## Setup

- **Runtime:** Node.js 24, managed via mise (`mise install`).
- **Package manager:** pnpm via corepack (`corepack enable`).
- `pnpm install` pulls dependencies and runs `pnpm prepare`, which installs the lefthook git hooks. If you install dependencies another way, run `pnpm prepare` once so the hooks fire.
- **In a fresh git worktree, run `pnpm install --ignore-scripts` once before anything else.** pnpm runs a deps-state check before each `run`/`exec`; an unrecorded state in a new worktree triggers an implicit `pnpm install` whose `prepare` step (`lefthook install`) fails because `core.hooksPath` already points at the main checkout's hooks — and that failure takes down the whole command, including every `git commit`/`git push` (the hooks shell out to `pnpm exec`). `--ignore-scripts` records the deps-state without re-running `prepare`. Don't touch `core.hooksPath` (it's shared with the main checkout).

## Commands

| Command                             | Description                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`                          | Run the dev server via tsx                                                     |
| `pnpm build`                        | Compile TypeScript to `dist/`                                                  |
| `pnpm test` / `pnpm test:watch`     | Run the vitest suite (once / in watch mode)                                    |
| `pnpm typecheck`                    | Type-check source (`tsc --noEmit`) and the test project (`tsconfig.test.json`) |
| `pnpm lint` / `pnpm lint:fix`       | oxlint (`--deny-warnings`) over `src/`                                         |
| `pnpm format` / `pnpm format:check` | oxfmt over the tree                                                            |
| `pnpm generate:fixtures`            | Regenerate typed fixtures from the HAR captures in `docs/wire-captures/`       |

`tsconfig.json` excludes tests and fixtures; `tsconfig.test.json` extends it to type-check everything with `noEmit`, so build output is unaffected.

## Code conventions

- **ESM only** — `import`/`export`, never CommonJS. Always use `.js` extensions in relative imports (`import { foo } from "./bar.js"`).
- **Imports are organized by the tools, not by hand** — oxfmt's `sortImports` sorts and groups import _statements_ (builtin → external → your own modules, with `import type` ahead of value imports inside the local block), and the oxlint `sort-imports` rule alphabetizes the named members inside `{ }`. Both auto-fix on commit and are gated in CI; the `sortImports` block in `.oxfmtrc.json` and the `sort-imports` rule in `.oxlintrc.json` are the source of truth. Don't hand-order imports — let the tools do it. (One known wrinkle: member sorting alphabetizes semantic groupings like `Create, Update, Delete`; disable it on a specific line with `// oxlint-disable-next-line sort-imports` if that ordering matters.)
- **Strict TypeScript** via `@tsconfig/strictest` — no `any`, no implicit returns, no unused variables. `interface` for extensible object shapes, `type` for unions and intersections, `readonly` where mutation is not needed.
- **Error handling** — neverthrow `Result<T, E>` in the functional core (never throw there); idiomatic `.match()` / `.andThen()` / `.map()` / `.mapErr()`, never `.isOk()` / `.isErr()`. Validate inputs with Zod at boundaries. Infrastructure that wraps exception-throwing libraries (cockatiel, the file-backed vector index) catches at the boundary; see `docs/architecture.md`.
- **No `console`** — banned by the `no-console` oxlint rule. In stdio mode stdout _is_ the MCP wire, so stray output corrupts the protocol; use the structured logger (`ctx.log.child({ component })`). The three documented `process.stderr.write` exceptions are the signal handler in `src/index.ts`, the pre-context misconfiguration warning in `src/transport/stdio.ts`, and the OpenTelemetry diag logger in `src/telemetry/`.

## Testing

- Runner: **vitest**, split into four projects by tier ([ADR-0013](docs/adr/0013-test-pyramid-and-tiers.md)). `pnpm test` runs all four and is the gate; `pnpm test:unit` / `test:integration` / `test:e2e` / `test:external` run one tier. Tests stay colocated in `src/` next to the code they exercise:
  - **unit** (`*.test.ts`) — a single unit in isolation (a store, a helper, a schema), the harness-driven **module-integration** tool/resource tests (`useKernelHarness` builds a module plus its dependency closure and real caches — no sync, no transport), and property tests (`*.property.test.ts`, fast-check). All end in `.test.ts`.
  - **integration** (`*.test.integration.ts`) — several real subsystems short of the wire (the real `buildKernel` running its boot sync, cold-start disk persistence).
  - **e2e** (`*.e2e.test.ts`) — crosses the real transport or process boundary (the MCP SDK over stdio, HTTP with the OAuth flow).
  - **external** (`*.external.test.ts`) — needs a live external service (Ollama embeddings); self-skips when it is absent, so CI is unaffected.
- Fixtures, generated wire-captures, and test helpers live in a top-level `test/` tree that mirrors `src/`: `test/support/` (cross-cutting helpers), `test/fixtures/` (shared data + `wire-captures/`), and `test/domains/<domain>/__fixtures__/` (per-entity data factories mirroring `src/domains/`; non-domain areas like `auth/` and `paprika/` keep their own `test/<area>/__fixtures__/`). Tests stay in `src/`; only the support code lives under `test/`. Imports are plain relative (no path aliases). See `docs/adr/0006-test-fixtures-out-of-src.md` and `test/CLAUDE.md`.
- HTTP is mocked with **msw**.
- Coverage target: ≥ 70% for new code.
- **The unit test harness bypasses Zod.** `test/support`'s `makeTestServer().callTool(name, args)` invokes the tool handler with the **raw args object** — it does not run the tool's Zod `inputSchema` the way the real MCP SDK does. Two consequences: (1) don't rely on a schema `.default()` for a value the handler reads — it's `undefined` under `callTool`, so apply the fallback in the handler; (2) don't assert a `.strict()` rejection through `callTool` (the stale key reaches the handler unparsed) — test it on the exported schema directly (`schema.safeParse(…).success === false`). The end-to-end SDK rejection is guarded once in the stdio e2e test, not per tool.

## Commits and pull requests

- **Conventional Commits**, validated by the `commit-msg` hook against [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint): the standard type enum, free-form scopes. The enum is owned by the preset and is not re-listed here. Wrap body lines at 100 characters.
- **Atomic commits** — one logical change each, describable in a sentence without "and".
- **Hooks (lefthook):** pre-commit runs oxlint `--fix` then oxfmt over staged files — sequentially (both rewrite files, so they can't race) and both auto-restaging; commit-msg runs commitlint; pre-push runs `pnpm typecheck` and `pnpm test`. Do not bypass them.
- **Squash-merge** — the PR body becomes the commit body, so write it as "what shipped": a one- or two-sentence lead (no `## Summary`) then detail. Transient verification (test plans, screenshots) goes in a PR comment, not the body.
- **Dependencies** — add with `pnpm add` (latest stable); do not hand-pin. Renovate keeps existing pins current.
- **Held upgrade:** the Zod 4 major (`renovate/zod-4.x`) is intentionally **not** merged until `@modelcontextprotocol/sdk` 2.0 ships — the SDK peer-depends on Zod 3 internals, so upgrading first would break the dependency chain. Renovate keeps rebasing that branch; the churn is expected, not a signal to land it.

## CI

GitHub Actions gate every PR and push to `main`: `ci.yml` (format check, lint, typecheck, build, test) and `pr-title.yml` (conventional PR title). All checks must pass before merge.

## Version sync

- `packageManager` in `package.json` matches the corepack-managed pnpm version.
- `engines.node` matches the Node version in `mise.toml`, which matches `node-version` in `.github/workflows/ci.yml`.

## Boundaries

- `dist/` and `node_modules/` are gitignored; never edit them.
- `.env` files hold secrets; never commit them.
- `pnpm-lock.yaml` is generated; do not hand-edit it.
