# mcp-paprika

Last verified: 2026-03-06

MCP server for the Paprika recipe manager. Communicates over stdio transport — `console.log` writes to stdout which is the MCP wire format. Any stray console output corrupts the protocol. Use the MCP SDK's logging facility for diagnostics.

## Tech Stack

- **Runtime:** Node.js 24 (managed via mise)
- **Language:** TypeScript 5.9 (extends `@tsconfig/strictest` + `@tsconfig/node24`)
- **Module system:** ESM (`"type": "module"`)
- **Package manager:** pnpm 10.30.3 (corepack-managed)
- **Key dependencies:** zod (validation), luxon (dates), dotenv (env config), parse-duration, neverthrow (error handling)

## Commands

| Command             | Description                                                          |
| ------------------- | -------------------------------------------------------------------- |
| `pnpm build`        | Compile TypeScript to `dist/`                                        |
| `pnpm dev`          | Run dev server via tsx                                               |
| `pnpm test`         | Run vitest test suite                                                |
| `pnpm test:watch`   | Run vitest in watch mode                                             |
| `pnpm typecheck`    | Type-check without emitting (`tsc --noEmit`)                         |
| `pnpm lint`         | Run oxlint with `--deny-warnings` on `src/`                          |
| `pnpm lint:fix`     | Run oxlint with `--fix` on `src/`                                    |
| `pnpm format`       | Format all files with oxfmt                                          |
| `pnpm format:check` | Check formatting without writing changes                             |
| `pnpm prepare`      | Install lefthook git hooks (runs automatically after `pnpm install`) |

## Project Structure

- `src/index.ts` — Entry point
- `src/paprika/` — Paprika API client
- `src/cache/` — Caching layer
- `src/tools/` — MCP tool definitions
- `src/resources/` — MCP resource definitions
- `src/features/` — Feature implementations
- `src/types/` — Shared type definitions
- `src/utils/` — Cross-cutting utilities

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

### No Console

`console.log` is banned via the `no-console` oxlint rule. This MCP server uses stdio transport — any stdout output corrupts the protocol wire format.

## Dependency Policy

Minimize runtime dependencies. Every new dependency must justify its inclusion:

- Prefer Node.js built-in modules when available
- Evaluate bundle size and maintenance status before adding packages
- Current runtime deps: `zod`, `luxon`, `dotenv`, `parse-duration`, `env-paths`, `neverthrow`

## Testing

- **Runner:** vitest
- **Test location:** Colocated with source as `src/**/*.test.ts`
- **Property-based tests:** `*.property.test.ts` (using fast-check)
- **Integration tests:** `*.test.integration.ts`
- **Coverage target:** ≥ 70% for new code

## Git Conventions

### Commit Format

Conventional commits: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `build`, `chore`, `revert`

Breaking changes: use `!` after type (e.g., `feat!: change API`) or `BREAKING CHANGE:` footer.

### Hooks

Git hooks managed by lefthook, activated via `pnpm install` (the `prepare` script).

- **pre-commit:** oxfmt formats staged files (auto-restages), oxlint checks staged `.ts` files
- **commit-msg:** commitlint validates conventional commit format
- **pre-push:** runs `pnpm typecheck` and `pnpm test` before push

Hooks must not be bypassed. Fix issues before committing. If you commit before running `pnpm install`, hooks will not fire.

## Version Sync

- `packageManager` field in `package.json` must match the pnpm version managed by corepack
- `engines.node` must match the Node.js version in `mise.toml`

## Boundaries

- `dist/` and `node_modules/` are gitignored — never edit
- `.env` files contain secrets — never commit
- `pnpm-lock.yaml` is auto-generated — do not hand-edit
