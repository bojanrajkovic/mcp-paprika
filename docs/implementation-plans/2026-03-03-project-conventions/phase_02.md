# Project Conventions Implementation Plan — Phase 2

**Goal:** Overhaul the root CLAUDE.md with comprehensive conventions and create domain-level CLAUDE.md stubs in all 7 `src/` subdirectories.

**Architecture:** Documentation phase — no application code or tooling changes. The root CLAUDE.md is rewritten from a 35-line primer to a comprehensive conventions reference. Domain-level stubs establish a per-module documentation pattern for later implementation units to fill in.

**Tech Stack:** Markdown files only. oxfmt (from Phase 1) formats the markdown.

**Scope:** 2 phases from original design (phase 2 of 2)

**Codebase verified:** 2026-03-03

---

## Acceptance Criteria Coverage

This phase implements and verifies operationally:

### project-conventions.AC1: CLAUDE.md is comprehensive and accurate

- **project-conventions.AC1.1 Success:** Root CLAUDE.md exists and covers all convention categories: tech stack, commands, code conventions (imports, TypeScript style, error handling), dependency policy, testing, git conventions, version sync
- **project-conventions.AC1.2 Success:** All 7 package.json scripts are documented in the Commands section
- **project-conventions.AC1.3 Success:** Dependency policy states "minimize runtime dependencies" (not "zero dependencies")
- **project-conventions.AC1.4 Success:** Domain-level CLAUDE.md stubs exist in all 7 `src/` subdirectories with Purpose, Contracts, and Dependencies sections

---

<!-- START_TASK_1 -->

### Task 1: Overhaul root CLAUDE.md

**Files:**

- Modify: `CLAUDE.md` (complete rewrite)

**Step 1: Replace `CLAUDE.md` with comprehensive conventions**

Overwrite the existing `CLAUDE.md` (currently 35 lines) with the following content. Use `date +%Y-%m-%d` to get the current date for the "Last verified" field.

```markdown
# mcp-paprika

Last verified: YYYY-MM-DD

MCP server for the Paprika recipe manager. Communicates over stdio transport — `console.log` writes to stdout which is the MCP wire format. Any stray console output corrupts the protocol. Use the MCP SDK's logging facility for diagnostics.

## Tech Stack

- **Runtime:** Node.js 24 (managed via mise)
- **Language:** TypeScript 5.9 (extends `@tsconfig/strictest` + `@tsconfig/node24`)
- **Module system:** ESM (`"type": "module"`)
- **Package manager:** pnpm 10.30.3 (corepack-managed)
- **Key dependencies:** zod (validation), luxon (dates), dotenv (env config), parse-duration

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
- Current runtime deps: `zod`, `luxon`, `dotenv`, `parse-duration`

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
```

Replace `YYYY-MM-DD` with the actual date from `date +%Y-%m-%d`.

**Step 2: Format the file**

```bash
pnpm format
```

**Step 3: Verify format check passes**

```bash
pnpm format:check
```

Expected: Exits 0.

**Step 4: Verify content coverage (AC1.1, AC1.2, AC1.3)**

Manually confirm:

- All convention categories present: tech stack, commands, code conventions (imports, TypeScript style, error handling), dependency policy, testing, git conventions, version sync ✓
- All 10 package.json scripts documented in Commands table (7 from design + 3 from implementation guidance: typecheck, test:watch, lint:fix) ✓
- Dependency policy says "Minimize runtime dependencies" (not "zero dependencies") ✓

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: overhaul CLAUDE.md with comprehensive conventions

Cover tech stack, all 10 commands, code conventions (imports, TypeScript
style, error handling), dependency policy, testing, git conventions,
and version sync."
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create domain-level CLAUDE.md stubs in all 7 src/ subdirectories

**Files:**

- Create: `src/paprika/CLAUDE.md`
- Create: `src/cache/CLAUDE.md`
- Create: `src/tools/CLAUDE.md`
- Create: `src/resources/CLAUDE.md`
- Create: `src/features/CLAUDE.md`
- Create: `src/types/CLAUDE.md`
- Create: `src/utils/CLAUDE.md`

**Step 1: Create all 7 domain-level CLAUDE.md stubs**

Each stub follows the same template with Purpose, Contracts, and Dependencies sections. The Purpose section has a brief description; Contracts and Dependencies are placeholders for later implementation units to fill in.

Use `date +%Y-%m-%d` for the "Last verified" date in each file.

**`src/paprika/CLAUDE.md`:**

```markdown
# Paprika API Client

Last verified: YYYY-MM-DD

## Purpose

HTTP client for the Paprika Cloud Sync API. Handles authentication, request formatting, and response parsing for recipe data.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** None yet
- **Used by:** `features/`, `tools/`, `resources/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
```

**`src/cache/CLAUDE.md`:**

```markdown
# Caching Layer

Last verified: YYYY-MM-DD

## Purpose

Caches Paprika API responses to reduce API calls and improve response times for MCP tool invocations.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** None yet
- **Used by:** `features/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
```

**`src/tools/CLAUDE.md`:**

```markdown
# MCP Tool Definitions

Last verified: YYYY-MM-DD

## Purpose

Defines MCP tools that AI assistants can invoke. Each tool maps to a capability exposed over the MCP protocol (e.g., search recipes, get recipe details).

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** `features/`, `types/`
- **Used by:** `index.ts` (MCP server registration)
- **Boundary:** Must not import from `paprika/` or `cache/` directly — use `features/` as the intermediary
```

**`src/resources/CLAUDE.md`:**

```markdown
# MCP Resource Definitions

Last verified: YYYY-MM-DD

## Purpose

Defines MCP resources that AI assistants can read. Resources expose data (e.g., recipe lists, categories) as structured content over the MCP protocol.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** `features/`, `types/`
- **Used by:** `index.ts` (MCP server registration)
- **Boundary:** Must not import from `paprika/` or `cache/` directly — use `features/` as the intermediary
```

**`src/features/CLAUDE.md`:**

```markdown
# Feature Implementations

Last verified: YYYY-MM-DD

## Purpose

Orchestrates business logic by composing the Paprika API client and caching layer. Provides high-level operations that tools and resources consume.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** `paprika/`, `cache/`, `types/`
- **Used by:** `tools/`, `resources/`
- **Boundary:** Must not import from `tools/` or `resources/`
```

**`src/types/CLAUDE.md`:**

```markdown
# Shared Type Definitions

Last verified: YYYY-MM-DD

## Purpose

Defines TypeScript types and Zod schemas shared across modules. Schemas are the single source of truth — TypeScript types are inferred from them.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** zod
- **Used by:** All other `src/` modules
- **Boundary:** Must not import from any other `src/` module (leaf dependency)
```

**`src/utils/CLAUDE.md`:**

```markdown
# Cross-Cutting Utilities

Last verified: YYYY-MM-DD

## Purpose

Shared utility functions and helpers used across multiple modules. Includes error base classes, logging helpers, and common transformations.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** None (leaf dependency)
- **Used by:** All other `src/` modules
- **Boundary:** Must not import from any other `src/` module (leaf dependency)
```

Replace `YYYY-MM-DD` with the actual date from `date +%Y-%m-%d` in each file.

**Step 2: Format all new markdown files**

```bash
pnpm format
```

**Step 3: Verify format check passes**

```bash
pnpm format:check
```

Expected: Exits 0 — all new markdown files are properly formatted.

**Step 4: Verify all 7 stubs exist with required sections (AC1.4)**

```bash
for dir in paprika cache tools resources features types utils; do
  echo "--- src/$dir/CLAUDE.md ---"
  head -20 "src/$dir/CLAUDE.md"
  echo
done
```

Expected: Each file exists and contains Purpose, Contracts, and Dependencies sections.

**Step 5: Commit**

```bash
git add src/paprika/CLAUDE.md src/cache/CLAUDE.md src/tools/CLAUDE.md src/resources/CLAUDE.md src/features/CLAUDE.md src/types/CLAUDE.md src/utils/CLAUDE.md
git commit -m "docs: add domain-level CLAUDE.md stubs for all src/ modules

Create Purpose, Contracts, and Dependencies stubs in paprika/, cache/,
tools/, resources/, features/, types/, and utils/. Later implementation
units will fill in contracts and details."
```

<!-- END_TASK_2 -->
