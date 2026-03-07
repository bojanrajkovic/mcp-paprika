# Human Test Plan: CI Pipeline

## Prerequisites

- Repository checked out at the `ci-pipeline` branch
- `pnpm install` has been run so tooling is available
- Access to the `.github/workflows/` directory
- `rg` (ripgrep) available for text searching

## Phase 1: CI Workflow Structure (AC1)

| Step | Action                                                                                                            | Expected                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1.1  | Run `ls -la .github/workflows/ci.yml` from the project root.                                                      | File exists, is a regular file, non-empty.                             |
| 1.2  | Run `pnpm format:check` from the project root.                                                                    | Command exits 0, confirming `ci.yml` is valid and well-formatted YAML. |
| 1.3  | Open `.github/workflows/ci.yml` and inspect the `on:` block. Confirm `pull_request: branches: [main]` is present. | The workflow triggers on pull requests targeting `main`.               |
| 1.4  | In the same `on:` block, confirm `push: branches: [main]` is present.                                             | The workflow triggers on pushes to `main`.                             |

## Phase 2: Quality Check Steps (AC2)

| Step | Action                                                                                                                                                                       | Expected                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 2.1  | In `ci.yml`, locate the step named "Format check". Confirm its `run:` value is `pnpm format:check`.                                                                          | Format check step runs oxfmt via `pnpm format:check`.    |
| 2.2  | In `ci.yml`, locate the step named "Lint". Confirm its `run:` value is `pnpm lint`. Then open `package.json` and confirm the `lint` script is `oxlint --deny-warnings src/`. | Lint step runs oxlint with `--deny-warnings`.            |
| 2.3  | In `ci.yml`, locate the step named "Build". Confirm its `run:` value is `pnpm build`.                                                                                        | Build step runs tsc compilation.                         |
| 2.4  | In `ci.yml`, locate the step named "Test". Confirm its `run:` value is `pnpm test`.                                                                                          | Test step runs vitest.                                   |
| 2.5  | Open `package.json` and confirm the `test` script is `vitest run --passWithNoTests`.                                                                                         | The test command will not fail when no test files exist. |

## Phase 3: Security Audit (AC3)

| Step | Action                                                                                                                | Expected                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 3.1  | In `ci.yml`, locate the step named "Security audit". Confirm its `run:` value is `pnpm audit --audit-level=moderate`. | Security audit step runs with moderate severity threshold.                   |
| 3.2  | Confirm there is NO `pnpm audit signatures` step in `ci.yml`.                                                         | Intentionally excluded because pnpm does not support signature verification. |

## Phase 4: Concurrency Management (AC4)

| Step | Action                                                                                                                     | Expected                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 4.1  | In `ci.yml`, locate the top-level `concurrency:` block. Confirm `cancel-in-progress: true` is set.                         | Concurrent runs for the same scope are cancelled.                                             |
| 4.2  | Confirm the `concurrency.group` value is `${{ github.workflow }}-${{ github.event.pull_request.number \|\| github.sha }}`. | Concurrency is scoped by PR number for pull request events and by commit SHA for push events. |

## Phase 5: Node and pnpm Setup (AC5)

| Step | Action                                                                                                                          | Expected                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 5.1  | In `ci.yml`, locate the `actions/setup-node` step. Confirm `node-version: "24"` and `cache: pnpm` are set in its `with:` block. | Node 24 is used with pnpm caching enabled.                                            |
| 5.2  | Confirm a `run: corepack enable` step appears BEFORE the `actions/setup-node` step in the `steps:` list.                        | Corepack is enabled before setup-node so that pnpm is available for cache resolution. |
| 5.3  | In `ci.yml`, confirm a step with `run: pnpm install --frozen-lockfile` exists after the setup-node step.                        | Dependencies are installed reproducibly with `--frozen-lockfile`.                     |

## Phase 6: PR Title Validation Workflow (AC6)

| Step | Action                                                                                                                                                                     | Expected                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 6.1  | Run `ls -la .github/workflows/pr-title.yml` from the project root.                                                                                                         | File exists, is a regular file, non-empty.                                        |
| 6.2  | Run `pnpm format:check` from the project root (if not already run in Phase 1).                                                                                             | Command exits 0, confirming `pr-title.yml` is valid and well-formatted YAML.      |
| 6.3  | Open `pr-title.yml` and inspect the `on:` block. Confirm `pull_request_target: types: [opened, edited, synchronize]`.                                                      | Workflow triggers on the correct PR lifecycle events using `pull_request_target`. |
| 6.4  | Locate the `uses: amannn/action-semantic-pull-request@...` step. Confirm the action reference is present.                                                                  | The workflow uses the semantic-pull-request action for validation.                |
| 6.5  | In the action's `with:` block, confirm the `types` input lists all 11 types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `build`, `chore`, `revert`, `style`. | All `@commitlint/config-conventional` types are accepted.                         |
| 6.6  | Confirm `subjectPattern: ^[a-z]` is set in the action's `with:` block.                                                                                                     | PR title subjects must start with a lowercase letter.                             |
| 6.7  | Confirm the action is NOT configured with `wip: true` or other permissive overrides that would bypass validation.                                                          | Non-conforming PR titles will be rejected.                                        |

## Phase 7: SHA-Pinned Actions (AC7)

| Step | Action                                                                                                                                                                                                                                                                                                             | Expected                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 7.1  | Run `rg 'uses:' .github/workflows/` and examine every result.                                                                                                                                                                                                                                                      | All `uses:` lines reference a full 40-character commit SHA (not a tag like `@v4`). |
| 7.2  | For each `uses:` line, confirm a version comment follows the SHA. Expected: `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`, `amannn/action-semantic-pull-request@0723387faaf9b38adef4775cd42cfd5155ed6017 # v5.5.3`. | Each SHA pin has a human-readable version comment. No tag-based references exist.  |

## Phase 8: Documentation Alignment (AC8)

| Step | Action                                                                                                                                                                                   | Expected                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 8.1  | Run `rg "style" CLAUDE.md` and inspect the commit types line.                                                                                                                            | `style` appears in the list alongside `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `build`, `chore`, `revert`. |
| 8.2  | Open `CLAUDE.md` and navigate to the "Version Sync" section. Confirm a bullet referencing `node-version` in `.github/workflows/ci.yml` and its sync requirement with `mise.toml` exists. | The bullet reads: `node-version` in `.github/workflows/ci.yml` must match the Node.js version in `mise.toml`.              |
| 8.3  | Confirm the "Project Structure" section in `CLAUDE.md` includes `.github/workflows/` with an appropriate description.                                                                    | The entry `.github/workflows/` is present.                                                                                 |
| 8.4  | Confirm the "Git Conventions" section in `CLAUDE.md` includes a "CI" subsection describing both workflows.                                                                               | A CI subsection exists describing both workflows and noting PRs must pass all checks before merge.                         |

## End-to-End: Full PR Lifecycle Simulation

| Step  | Action                                                                                                   | Expected                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| E2E.1 | Create a branch from `main` and open a PR with title `feat: add new feature`. Push the branch to GitHub. | Both `ci.yml` and `pr-title.yml` workflows trigger.                                                                               |
| E2E.2 | Observe the CI workflow run.                                                                             | All steps execute in order: checkout, corepack enable, setup-node, pnpm install, format:check, lint, security audit, build, test. |
| E2E.3 | Observe the PR title workflow run.                                                                       | The `feat: add new feature` title passes validation.                                                                              |
| E2E.4 | Edit the PR title to `Invalid Title` (no conventional commit prefix).                                    | The PR title workflow re-triggers and fails.                                                                                      |
| E2E.5 | Push a second commit to the same PR while the CI workflow is still running from the first push.          | The first CI run is cancelled due to `cancel-in-progress: true`. Only the second run completes.                                   |
| E2E.6 | Verify the Node.js version in `ci.yml` (`node-version: "24"`) matches the version in `mise.toml`.        | Versions are consistent per the Version Sync requirements.                                                                        |

## End-to-End: YAML Validity Under Formatting

| Step  | Action                                                        | Expected                                         |
| ----- | ------------------------------------------------------------- | ------------------------------------------------ |
| E2E.7 | Run `pnpm format:check` from the project root.                | Exits 0. Both workflow files are well-formatted. |
| E2E.8 | Run `pnpm build` to confirm no TypeScript compilation errors. | Exits 0. No regressions from CLAUDE.md edits.    |

## Traceability

| Acceptance Criterion                        | Manual Step         |
| ------------------------------------------- | ------------------- |
| AC1.1: ci.yml exists and valid YAML         | Phase 1: 1.1, 1.2   |
| AC1.2: PR trigger on main                   | Phase 1: 1.3        |
| AC1.3: Push trigger on main                 | Phase 1: 1.4        |
| AC2.1: Format check step                    | Phase 2: 2.1        |
| AC2.2: Lint step with --deny-warnings       | Phase 2: 2.2        |
| AC2.3: Build step                           | Phase 2: 2.3        |
| AC2.4: Test step                            | Phase 2: 2.4        |
| AC2.5: --passWithNoTests                    | Phase 2: 2.5        |
| AC3.1: pnpm audit --audit-level=moderate    | Phase 3: 3.1        |
| AC3.2: pnpm audit signatures (removed)      | Phase 3: 3.2        |
| AC4.1: cancel-in-progress                   | Phase 4: 4.1, E2E.5 |
| AC4.2: Concurrency group scoping            | Phase 4: 4.2        |
| AC5.1: setup-node with Node 24 + pnpm cache | Phase 5: 5.1        |
| AC5.2: corepack enable before setup-node    | Phase 5: 5.2        |
| AC5.3: pnpm install --frozen-lockfile       | Phase 5: 5.3        |
| AC6.1: pr-title.yml exists and valid YAML   | Phase 6: 6.1, 6.2   |
| AC6.2: pull_request_target triggers         | Phase 6: 6.3        |
| AC6.3: Semantic PR title action             | Phase 6: 6.4        |
| AC6.4: All 11 conventional commit types     | Phase 6: 6.5        |
| AC6.5: Lowercase subject pattern            | Phase 6: 6.6        |
| AC6.6: Rejects non-conforming titles        | Phase 6: 6.7, E2E.4 |
| AC7.1: SHA-pinned with version comments     | Phase 7: 7.1, 7.2   |
| AC8.1: CLAUDE.md includes style type        | Phase 8: 8.1        |
| AC8.2: CLAUDE.md version sync for ci.yml    | Phase 8: 8.2        |
