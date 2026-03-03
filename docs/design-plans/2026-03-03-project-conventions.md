# Project Conventions Design

## Summary

This design unit establishes the developer tooling and project conventions for mcp-paprika before any application code is written. It installs a Rust-based linting and formatting toolchain (oxlint, oxfmt), sets up git hooks via lefthook to enforce code quality and conventional commit messages automatically, and adds a test runner (vitest). No application logic is introduced — the deliverable is configuration files and documentation.

The root CLAUDE.md is overhauled to serve as the authoritative conventions reference for both human developers and Claude Code agents working in this repository. Domain-level CLAUDE.md stubs are created in each of the seven `src/` subdirectories to establish a per-module documentation pattern that later implementation units will fill in. The approach favors minimal configuration: each tool runs with its defaults, and only rules that TypeScript's compiler does not already cover are added to the linter.

## Definition of Done

1. **CLAUDE.md** is overhauled to be the comprehensive conventions document — covering tech stack, commands, code style, error handling, testing, git conventions, and dependency policy.
2. **Git hooks work end-to-end** — lefthook runs oxfmt + oxlint on pre-commit and commitlint on commit-msg. A bad commit message is rejected; a conventional one passes.
3. **Linting and formatting scripts exist** — `pnpm lint`, `pnpm format`, `pnpm format:check`, `pnpm test` all run their respective tools.
4. **oxlint config** is minimal and non-redundant with tsc — only `eqeqeq: error` and `no-console: error` beyond defaults.

## Acceptance Criteria

### project-conventions.AC1: CLAUDE.md is comprehensive and accurate
- **project-conventions.AC1.1 Success:** Root CLAUDE.md exists and covers all convention categories: tech stack, commands, code conventions (imports, TypeScript style, error handling), dependency policy, testing, git conventions, version sync
- **project-conventions.AC1.2 Success:** All 7 package.json scripts are documented in the Commands section
- **project-conventions.AC1.3 Success:** Dependency policy states "minimize runtime dependencies" (not "zero dependencies")
- **project-conventions.AC1.4 Success:** Domain-level CLAUDE.md stubs exist in all 7 `src/` subdirectories with Purpose, Contracts, and Dependencies sections

### project-conventions.AC2: Git hooks enforce conventions
- **project-conventions.AC2.1 Success:** `pnpm exec lefthook run pre-commit` executes oxfmt and oxlint on staged files
- **project-conventions.AC2.2 Success:** Pre-commit hook auto-stages files reformatted by oxfmt (`stage_fixed: true`)
- **project-conventions.AC2.3 Success:** A commit with message `feat(tools): add search tool` passes the commit-msg hook
- **project-conventions.AC2.4 Failure:** A commit with message `bad message` is rejected by the commit-msg hook
- **project-conventions.AC2.5 Failure:** A commit with a file containing `==` comparison (not `===`) is rejected by the pre-commit lint hook

### project-conventions.AC3: Linting and formatting scripts work
- **project-conventions.AC3.1 Success:** `pnpm lint` runs oxlint with `--deny-warnings` on `src/` and exits 0 on clean code
- **project-conventions.AC3.2 Success:** `pnpm format` runs oxfmt with `--write` and formats all project files
- **project-conventions.AC3.3 Success:** `pnpm format:check` runs oxfmt with `--check` and exits 0 when files are formatted
- **project-conventions.AC3.4 Success:** `pnpm test` runs vitest and exits 0 (with "no test files found" at this stage)
- **project-conventions.AC3.5 Failure:** `pnpm format:check` exits non-zero when a file has incorrect formatting

### project-conventions.AC4: oxlint config is minimal and correct
- **project-conventions.AC4.1 Success:** `.oxlintrc.json` configures `eqeqeq` as error
- **project-conventions.AC4.2 Success:** `.oxlintrc.json` configures `no-console` as error
- **project-conventions.AC4.3 Success:** `.oxlintrc.json` does NOT configure `no-unused-vars` (handled by tsc via `@tsconfig/strictest`)

## Glossary

- **MCP (Model Context Protocol)**: A protocol for communication between AI assistants (such as Claude) and tool servers. mcp-paprika implements an MCP server, meaning it exposes tools and resources to an AI client over a defined transport channel.
- **stdio transport**: The communication mechanism used by this MCP server, where messages are exchanged over standard input/output. Because `console.log` writes to stdout, any stray log output corrupts the protocol wire format.
- **lefthook**: A Git hooks manager that intercepts commits and runs configured commands (linting, formatting, commit message validation) before the commit is finalized. Replaces the husky + lint-staged combination.
- **oxlint**: A Rust-based JavaScript/TypeScript linter. Substantially faster than ESLint; used here to enforce rules that TypeScript's own compiler does not cover.
- **oxfmt**: A Rust-based TypeScript/JavaScript formatter, compatible with Prettier's output. Pairs with oxlint in the same toolchain.
- **commitlint**: A tool that validates git commit messages against a configurable format. Used here with the conventional commits preset.
- **Conventional Commits**: A commit message specification that structures messages as `type(scope): description` (e.g., `feat(tools): add search tool`). Enables automated changelog generation and semantic versioning.
- **vitest**: A test runner designed for ESM-native, TypeScript-first projects. Installed in this unit; test configuration is deferred to the first unit that writes tests.
- **`@tsconfig/strictest`**: A shared TypeScript configuration preset that enables the strictest available type-checking options, including rules like `no-unused-vars` that overlap with some linter rules.
- **`stage_fixed: true`**: A lefthook option that automatically re-stages files that were modified by an auto-formatter during the pre-commit hook, so the formatted version is included in the commit rather than left as an unstaged change.
- **`prepare` script**: A lifecycle hook in npm/pnpm that runs automatically after `pnpm install`. Used here to run `lefthook install`, so git hooks are activated on every fresh clone without a manual setup step.
- **neverthrow**: A TypeScript library for explicit error handling using `Result` types instead of thrown exceptions. Referenced in CLAUDE.md as a convention for future implementation units, not installed in this unit.
- **CLAUDE.md**: A markdown file that Claude Code agents read as context when working in a directory. The root file covers project-wide conventions; per-subdirectory files document module-level purpose and contracts.

## Architecture

This unit installs developer tooling and establishes conventions that all subsequent implementation units must follow. No application code is written — only configuration files and documentation.

The toolchain forms a pipeline:

1. **Developer writes code** in `src/`
2. **On commit**, lefthook intercepts and runs two parallel checks:
   - oxfmt reformats staged `.ts`, `.json`, and `.md` files, then re-stages them (`stage_fixed: true`)
   - oxlint checks staged `.ts` files for lint errors
3. **On commit-msg**, lefthook runs commitlint to validate conventional commit format
4. **In CI** (configured by the separate P1-U00b unit), `pnpm lint`, `pnpm format:check`, and `pnpm test` run as independent steps

The root `CLAUDE.md` serves as the authoritative conventions reference for both human developers and Claude Code agents. Domain-level `CLAUDE.md` stubs in each `src/` subdirectory establish a pattern for per-module documentation that later units fill in.

### Tool Choices

| Tool | Purpose | Why This Over Alternatives |
|------|---------|---------------------------|
| lefthook | Git hooks | Single tool replaces husky + lint-staged. YAML config. Used in author's unquote project. |
| oxlint | Linting | Rust-based, significantly faster than ESLint. Sufficient rule coverage for this project. Used in author's grounds project. |
| oxfmt | Formatting | Rust-based, pairs with oxlint. Prettier-compatible. Beta but stable enough for this project. |
| commitlint | Commit messages | Enforces conventional commits format required for future automated changelog (P3-U09). |
| vitest | Test runner | Fast, ESM-native, TypeScript-first. Dependency installed here; configuration deferred to first unit that writes tests. |

### Configuration Philosophy

Minimal configuration. Each tool's defaults do the right thing for most cases. We only configure:
- oxlint: two rules that tsc doesn't cover (`eqeqeq`, `no-console`)
- oxfmt: print width (120) and ignore patterns (`pnpm-lock.yaml`, `dist`)
- commitlint: extend `@commitlint/config-conventional` with no custom rules
- lefthook: hook definitions (unavoidable — this is the tool's purpose)

## Existing Patterns

This is a new project. P1-U01 (project scaffold) established the initial structure:
- `package.json` with `build` and `dev` scripts
- `tsconfig.json` extending `@tsconfig/strictest` and `@tsconfig/node24`
- 7 `src/` subdirectories with `.gitkeep` placeholders
- A basic `CLAUDE.md` created by the project-claude-librarian (35 lines)

Conventions are drawn from two existing projects by the same author:
- **grounds** (TypeScript monorepo): oxlint, oxfmt, vitest, neverthrow, conventional commits
- **unquote** (multi-language monorepo): lefthook, mise, hierarchical CLAUDE.md files

This design combines patterns from both: lefthook from unquote, oxlint/oxfmt from grounds, hierarchical CLAUDE.md from unquote.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Tool Installation and Configuration

**Goal:** Install all dev tooling, create configuration files, and verify the toolchain works end-to-end.

**Components:**
- Dev dependencies: `oxlint`, `oxfmt`, `lefthook`, `@commitlint/cli`, `@commitlint/config-conventional`, `vitest`
- `package.json` script additions: `test`, `lint`, `format`, `format:check`, `prepare`
- `.oxlintrc.json` — lint rules (`eqeqeq: error`, `no-console: error`)
- `.oxfmtrc.json` — formatting config (`printWidth: 120`, ignore patterns)
- `commitlint.config.mjs` — extends `@commitlint/config-conventional`, no scope-enum
- `lefthook.yml` — pre-commit (oxfmt + oxlint parallel) and commit-msg (commitlint) hooks

**Dependencies:** P1-U01 (project scaffold) must be complete.

**Done when:**
- `pnpm lint` runs oxlint on `src/` and exits clean
- `pnpm format:check` runs oxfmt and exits clean
- `pnpm test` runs vitest (exits 0 with "no test files found")
- `pnpm exec lefthook run pre-commit` executes format + lint hooks
- `pnpm exec lefthook run commit-msg` validates a conventional commit message
- A commit with message `bad message` is rejected by the hook
- A commit with message `feat(tools): add search tool` is accepted
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: CLAUDE.md and Documentation

**Goal:** Overhaul the root CLAUDE.md with comprehensive conventions and create domain-level CLAUDE.md stubs in all `src/` subdirectories.

**Components:**
- Root `CLAUDE.md` — full overhaul covering: project description, tech stack, commands (all 7 scripts), code conventions (imports/modules, TypeScript style, error handling), dependency policy, testing conventions, git conventions (commit format, branch naming), version sync notes
- Domain-level `CLAUDE.md` stubs in `src/paprika/`, `src/cache/`, `src/utils/`, `src/tools/`, `src/types/`, `src/features/`, `src/resources/` — minimal template with Purpose, Contracts, and Dependencies placeholders

**Dependencies:** Phase 1 (oxfmt must be installed to format the new markdown files).

**Done when:**
- Root `CLAUDE.md` covers all convention categories listed in the spec
- Domain-level `CLAUDE.md` exists in all 7 `src/` subdirectories
- All markdown files pass `pnpm format:check`
<!-- END_PHASE_2 -->

## Additional Considerations

**`no-console` as safety rule:** In this MCP server, `console.log` writes to stdout which is the MCP transport channel. Any stray console output corrupts the protocol. The `no-console: error` rule is not a style preference — it prevents a class of runtime bugs unique to stdio-based servers.

**`prepare` script lifecycle:** The `prepare` script runs automatically after `pnpm install`. This means `lefthook install` fires on every fresh clone or dependency update. Anyone who clones the repo and runs `pnpm install` gets git hooks activated without extra steps. However, if someone runs `git commit` before `pnpm install`, hooks won't fire — this is documented in CLAUDE.md.

**CLAUDE.md forward-looking content:** The CLAUDE.md documents conventions for patterns that don't exist yet in the codebase (e.g., neverthrow Result types, PaprikaError base class). This is intentional — agents implementing subsequent units should know the conventions before writing code, not discover them after.
