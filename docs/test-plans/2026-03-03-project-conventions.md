# Human Test Plan: Project Conventions

## Prerequisites

- Node.js 24 installed (via mise)
- `pnpm install` has been run (hooks are installed via the `prepare` script)
- All automated checks passing:
  - `pnpm lint` exits 0
  - `pnpm format:check` exits 0
  - `pnpm test` exits 0
  - `pnpm typecheck` exits 0

---

## Phase 1: Root CLAUDE.md Content Review (AC1.1)

**File:** `CLAUDE.md`

| Step | Action                                                                                                                    | Expected                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Open `CLAUDE.md` and locate the "Tech Stack" section                                                                      | Section exists with entries for Runtime (Node.js 24), Language (TypeScript 5.9), Module system (ESM), Package manager (pnpm 10.30.3), and Key dependencies |
| 1.2  | Locate the "Commands" section                                                                                             | Section exists with a table listing all scripts                                                                                                            |
| 1.3  | Locate "Code Conventions" section and its subsections                                                                     | Contains "Imports and Modules", "TypeScript Style", "Error Handling", and "No Console" subsections with substantive guidance in each                       |
| 1.4  | Locate "Dependency Policy" section                                                                                        | Section exists with guidance on minimizing dependencies                                                                                                    |
| 1.5  | Locate "Testing" section                                                                                                  | Section exists with runner, test location patterns, property-based test pattern, integration test pattern, and coverage target                             |
| 1.6  | Locate "Git Conventions" section                                                                                          | Contains "Commit Format" and "Hooks" subsections describing conventional commits and lefthook configuration                                                |
| 1.7  | Locate "Version Sync" section                                                                                             | Section exists with guidance on packageManager and engines.node alignment                                                                                  |
| 1.8  | Verify content quality: read each section and confirm the guidance is accurate, actionable, and not just placeholder text | Each section contains specific, project-relevant instructions (not generic boilerplate)                                                                    |

---

## Phase 2: Commands Table Completeness (AC1.2)

**Files:** `CLAUDE.md` and `package.json`

| Step | Action                                                                                                    | Expected                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Open `package.json` and list all scripts                                                                  | 10 scripts: `build`, `dev`, `format`, `format:check`, `lint`, `lint:fix`, `prepare`, `test`, `test:watch`, `typecheck` |
| 2.2  | Open the Commands table in `CLAUDE.md` and cross-reference each `package.json` script                     | All 10 scripts appear in the Commands table                                                                            |
| 2.3  | For each entry in the Commands table, verify the description matches the actual command in `package.json` | Descriptions accurately reflect the underlying commands                                                                |

---

## Phase 3: Dependency Policy Wording (AC1.3)

**File:** `CLAUDE.md`

| Step | Action                                                 | Expected                                              |
| ---- | ------------------------------------------------------ | ----------------------------------------------------- |
| 3.1  | Read the Dependency Policy section                     | First sentence reads "Minimize runtime dependencies." |
| 3.2  | Confirm it does NOT use the phrase "zero dependencies" | The word "zero" does not appear in this section       |

---

## Phase 4: Domain-Level CLAUDE.md Stubs (AC1.4)

**Files:** 7 files in `src/` subdirectories

| Step | Action                                          | Expected                                                                                                                                                  |
| ---- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | Confirm `src/paprika/CLAUDE.md` exists          | File exists with title "Paprika API Client" and Purpose, Contracts, Dependencies sections                                                                 |
| 4.2  | Confirm `src/cache/CLAUDE.md` exists            | File exists with title "Caching Layer" and Purpose, Contracts, Dependencies sections                                                                      |
| 4.3  | Confirm `src/tools/CLAUDE.md` exists            | File exists with title "MCP Tool Definitions" and Purpose, Contracts, Dependencies sections                                                               |
| 4.4  | Confirm `src/resources/CLAUDE.md` exists        | File exists with title "MCP Resource Definitions" and Purpose, Contracts, Dependencies sections                                                           |
| 4.5  | Confirm `src/features/CLAUDE.md` exists         | File exists with title "Feature Implementations" and Purpose, Contracts, Dependencies sections                                                            |
| 4.6  | Confirm `src/types/CLAUDE.md` exists            | File exists with title "Shared Type Definitions" and Purpose, Contracts, Dependencies sections                                                            |
| 4.7  | Confirm `src/utils/CLAUDE.md` exists            | File exists with title "Cross-Cutting Utilities" and Purpose, Contracts, Dependencies sections                                                            |
| 4.8  | Review dependency boundaries across all 7 stubs | Dependency graph is a DAG with no cycles: types/utils are leaf deps, paprika/cache are mid-level, features orchestrates, tools/resources consume features |

---

## End-to-End: Full Developer Workflow

**Purpose:** Validates that a new contributor can clone, install, and have all conventions enforced automatically.

| Step  | Action                                                                                                                   | Expected                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| E2E.1 | Run `pnpm install` in the project root                                                                                   | Completes successfully; output includes lefthook hook installation |
| E2E.2 | Create `src/test-e2e.ts` with `const x = 1 == 2;\nconsole.log(x);`                                                       | File created                                                       |
| E2E.3 | Stage and attempt `git commit -m "bad message"`                                                                          | Commit fails: oxlint reports `eqeqeq` and `no-console` errors      |
| E2E.4 | Fix file to `const x = 1 === 2;\nexport { x };`, re-stage, commit with `git commit -m "test: add e2e verification file"` | Pre-commit passes, commit-msg passes, commit succeeds              |
| E2E.5 | Run `pnpm lint`                                                                                                          | Exits 0                                                            |
| E2E.6 | Run `pnpm format:check`                                                                                                  | Exits 0                                                            |
| E2E.7 | Run `pnpm test`                                                                                                          | Exits 0                                                            |
| E2E.8 | Clean up: `git reset HEAD~1` and `rm src/test-e2e.ts`                                                                    | Working tree restored                                              |

---

## Traceability

| Acceptance Criterion                               | Automated                      | Manual Step |
| -------------------------------------------------- | ------------------------------ | ----------- |
| AC1.1 - Root CLAUDE.md completeness                | --                             | Phase 1     |
| AC1.2 - Commands table completeness                | --                             | Phase 2     |
| AC1.3 - Dependency policy wording                  | --                             | Phase 3     |
| AC1.4 - Domain CLAUDE.md stubs                     | --                             | Phase 4     |
| AC2.1 - Pre-commit runs oxfmt and oxlint           | lefthook run pre-commit        | --          |
| AC2.2 - Pre-commit auto-stages formatted files     | stage_fixed verified           | --          |
| AC2.3 - Valid conventional commit accepted         | commitlint exits 0             | --          |
| AC2.4 - Invalid commit message rejected            | commitlint exits 1             | --          |
| AC2.5 - `==` comparison rejected by lint           | oxlint eqeqeq error            | --          |
| AC3.1 - `pnpm lint` exits 0                        | pnpm lint                      | --          |
| AC3.2 - `pnpm format` formats files                | pnpm format                    | --          |
| AC3.3 - `pnpm format:check` exits 0                | pnpm format:check              | --          |
| AC3.4 - `pnpm test` exits 0                        | pnpm test                      | --          |
| AC3.5 - `pnpm format:check` non-zero on bad format | format:check on corrupted file | --          |
| AC4.1 - eqeqeq configured as error                 | .oxlintrc.json inspection      | --          |
| AC4.2 - no-console configured as error             | .oxlintrc.json inspection      | --          |
| AC4.3 - no-unused-vars absent                      | .oxlintrc.json inspection      | --          |
