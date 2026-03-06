# CI Pipeline Design

## Summary

This design establishes a GitHub Actions CI pipeline for the mcp-paprika project. Two workflow files are introduced: `ci.yml` runs a sequential suite of quality checks — formatting, linting, type checking, a security audit of dependencies, and tests — on every pull request targeting `main` and every push to `main`; `pr-title.yml` validates that PR titles follow the project's conventional commit format so that squash-merge commit messages stay consistent without requiring manual review. Concurrent workflow runs on the same PR or branch are automatically cancelled to avoid wasted runner time.

The implementation follows patterns already established in the author's other projects while making one deliberate divergence: Node.js is set up with `actions/setup-node` and its built-in pnpm cache rather than the `mise-action` approach. This trades automatic version-file synchronisation for a simpler, single-step cache configuration. To compensate, the CLAUDE.md Version Sync section is updated to document the manual constraint that the `node-version` value in `ci.yml` must be kept in step with the `node` value in `mise.toml`.

## Definition of Done

A GitHub Actions CI pipeline (`.github/workflows/ci.yml`) that runs on PRs and pushes to `main`, validating formatting (oxfmt), linting (oxlint), type checking (tsc), tests (vitest), and security (pnpm audit + signature verification). A separate PR title validation job ensures squash-merge messages follow conventional commit format. Actions are SHA-pinned for reproducibility. Concurrent pushes cancel previous runs.

## Acceptance Criteria

### ci-pipeline.AC1: CI workflow exists and runs on correct triggers

- **ci-pipeline.AC1.1 Success:** `.github/workflows/ci.yml` exists and is valid YAML
- **ci-pipeline.AC1.2 Success:** Workflow triggers on pull requests targeting `main`
- **ci-pipeline.AC1.3 Success:** Workflow triggers on pushes to `main`

### ci-pipeline.AC2: Quality checks catch failures

- **ci-pipeline.AC2.1 Success:** Format check step runs `pnpm format:check` (oxfmt)
- **ci-pipeline.AC2.2 Success:** Lint step runs `pnpm lint` (oxlint with `--deny-warnings`)
- **ci-pipeline.AC2.3 Success:** Build step runs `pnpm build` (tsc compilation)
- **ci-pipeline.AC2.4 Success:** Test step runs `pnpm test` (vitest)
- **ci-pipeline.AC2.5 Success:** Test step does not fail when no test files exist (`--passWithNoTests`)

### ci-pipeline.AC3: Security audit validates dependencies

- **ci-pipeline.AC3.1 Success:** `pnpm audit --audit-level=moderate` runs and passes
- **ci-pipeline.AC3.2 Success:** `pnpm audit signatures` runs and verifies package signatures

### ci-pipeline.AC4: Concurrency management

- **ci-pipeline.AC4.1 Success:** Concurrent pushes to the same PR cancel previous in-progress runs
- **ci-pipeline.AC4.2 Success:** Concurrency group is scoped to PR number (or SHA for push events)

### ci-pipeline.AC5: Node and pnpm setup

- **ci-pipeline.AC5.1 Success:** `setup-node` uses Node 24 with pnpm caching enabled
- **ci-pipeline.AC5.2 Success:** `corepack enable` activates pnpm from `packageManager` field
- **ci-pipeline.AC5.3 Success:** `pnpm install --frozen-lockfile` ensures reproducible installs

### ci-pipeline.AC6: PR title validation

- **ci-pipeline.AC6.1 Success:** `.github/workflows/pr-title.yml` exists and is valid YAML
- **ci-pipeline.AC6.2 Success:** Workflow triggers on `pull_request_target` (opened, edited, synchronize)
- **ci-pipeline.AC6.3 Success:** Validates PR titles against conventional commit format
- **ci-pipeline.AC6.4 Success:** Accepts all `@commitlint/config-conventional` types: feat, fix, perf, refactor, docs, test, ci, build, chore, revert, style
- **ci-pipeline.AC6.5 Success:** Requires subject to start with a lowercase letter
- **ci-pipeline.AC6.6 Failure:** Rejects PR titles that don't match conventional commit format

### ci-pipeline.AC7: Actions are SHA-pinned

- **ci-pipeline.AC7.1 Success:** All `uses:` references in both workflows use full commit SHA pins with version comment

### ci-pipeline.AC8: Documentation alignment

- **ci-pipeline.AC8.1 Success:** CLAUDE.md commit types list includes `style` (full `@commitlint/config-conventional` set)
- **ci-pipeline.AC8.2 Success:** CLAUDE.md Version Sync section documents CI `node-version` sync requirement with `mise.toml`

## Glossary

- **SHA-pinning**: Referencing a GitHub Action by its full commit hash (`uses: owner/action@abc1234`) rather than a mutable tag, so the exact action code is locked and cannot change without a deliberate update. Guards against supply chain attacks.
- **oxfmt**: The formatter used by this project, invoked via `pnpm format:check` in CI.
- **oxlint**: The linter used by this project, invoked via `pnpm lint`. The `--deny-warnings` flag causes warnings to be treated as errors.
- **pnpm audit**: A pnpm command that checks installed packages against a vulnerability database (`--audit-level=moderate` fails on moderate-severity and above) and optionally verifies cryptographic signatures (`audit signatures`).
- **`--frozen-lockfile`**: A pnpm install flag that prevents the lockfile from being updated, ensuring the installed dependency tree exactly matches `pnpm-lock.yaml`.
- **corepack**: A Node.js tool that manages package manager versions. Running `corepack enable` activates the pnpm version declared in the `packageManager` field of `package.json`.
- **conventional commits**: A commit message specification (`<type>(<scope>): <description>`) that enables automated changelog generation. This project uses `@commitlint/config-conventional` as its ruleset.
- **`pull_request_target`**: A GitHub Actions trigger that runs workflows in the context of the base branch rather than the PR branch. Used for PR title validation so the workflow has access to PR metadata even for PRs from forks.
- **`amannn/action-semantic-pull-request`**: A third-party GitHub Action that validates PR titles against a conventional commit pattern.
- **concurrency group**: A GitHub Actions feature that identifies a set of runs as logically equivalent. When `cancel-in-progress: true` is set, starting a new run in the same group cancels any run already in progress.
- **squash merge**: A Git merge strategy that collapses all commits in a PR into a single commit on the target branch, making the PR title the de-facto commit message.

## Architecture

Two GitHub Actions workflows in `.github/workflows/`:

**`ci.yml`** — Build and quality checks. Triggers on PRs targeting `main` and pushes to `main`. Single job with sequential steps ordered cheapest-to-most-expensive for fast failure:

1. Checkout (`actions/checkout`)
2. Setup Node 24 (`actions/setup-node` with `cache: 'pnpm'`)
3. Enable corepack (activates pnpm from `packageManager` field)
4. Install dependencies (`pnpm install --frozen-lockfile`)
5. Format check (`pnpm format:check` — oxfmt)
6. Lint (`pnpm lint` — oxlint with `--deny-warnings`)
7. Security audit (`pnpm audit --audit-level=moderate`)
8. Signature verification (`pnpm audit signatures`)
9. Build (`pnpm build` — tsc compilation, doubles as typecheck)
10. Test (`pnpm test` — vitest)

Concurrency group keyed on `workflow + PR number (or SHA for push)` with `cancel-in-progress: true`. Job timeout of 10 minutes.

**`pr-title.yml`** — PR title validation. Triggers on `pull_request_target` (types: `opened`, `edited`, `synchronize`). Uses `amannn/action-semantic-pull-request` to validate PR titles match conventional commit format. No checkout or Node setup needed — the action reads the PR title from the GitHub event context.

Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `build`, `chore`, `revert`, `style` — the full `@commitlint/config-conventional` set.

All actions are SHA-pinned to specific commit hashes for reproducibility and supply chain security.

### Node Version Strategy

The CI workflow hardcodes `node-version: '24'` in the `setup-node` action. This must be kept in sync with the `node = "24"` value in `mise.toml`. The CLAUDE.md Version Sync section documents this constraint.

Alternative approaches (`mise-action`, `node-version-file`) were evaluated and rejected:

- `mise-action` requires manual pnpm cache management (multi-step store path + `actions/cache`)
- `node-version-file: 'package.json'` reads `engines.node` which uses a loose range (`">= 24"`)

The `setup-node` approach trades automatic version sync for simpler caching (`cache: 'pnpm'` handles everything).

## Existing Patterns

Investigation found CI workflows in the author's existing projects:

- `grounds/.github/workflows/ci.yml` — uses `mise-action`, manual pnpm caching, codecov
- `grounds/.github/workflows/pr-title.yml` — uses `action-semantic-pull-request@v6`
- `containerfile-ts/.github/workflows/ci.yml` — adds `pnpm audit` security checks
- `containerfile-ts/.github/workflows/pr-title.yml` — uses `pull_request_target` trigger

This design diverges from the `mise-action` pattern (uses `setup-node` instead for simpler caching) but follows all other established patterns: separate workflow files, SHA-pinned actions, `pull_request_target` for PR title checks, sequential quality steps, concurrency cancellation, and `pnpm audit` for security.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: CI Pipeline and Documentation

**Goal:** Create both workflow files and update CLAUDE.md for consistency.

**Components:**

- `.github/workflows/ci.yml` — build and quality check workflow
- `.github/workflows/pr-title.yml` — PR title validation workflow
- `CLAUDE.md` — add `style` to commit types list, add CI node-version sync note to Version Sync section

**Dependencies:** None (infrastructure phase, consumes existing `package.json` scripts from P1-U01 and P1-U00a)

**Done when:** Both workflow files are valid YAML, CLAUDE.md is updated, and `pnpm format:check` passes on all files.

<!-- END_PHASE_1 -->

## Additional Considerations

**CLAUDE.md sync requirement:** The `node-version: '24'` value in `ci.yml` is a new sync point. The existing CLAUDE.md Version Sync section documents `packageManager` and `engines.node` sync requirements. The CI node version should be added to this section.

**Commit type alignment:** Adding `style` to CLAUDE.md aligns the documented types with what `@commitlint/config-conventional` actually accepts. This prevents confusion where commitlint allows a type that CLAUDE.md doesn't list.
