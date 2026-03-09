# Project Conventions Implementation Plan — Phase 1

**Goal:** Install all dev tooling (oxlint, oxfmt, lefthook, commitlint, vitest), create configuration files, add package.json scripts, and verify the toolchain works end-to-end.

**Architecture:** Infrastructure phase — no application code is written. Dev dependencies are installed, configuration files created, and npm scripts added. The toolchain pipeline: oxfmt formats code, oxlint enforces lint rules beyond what tsc covers, commitlint validates commit messages, lefthook orchestrates these as git hooks, and vitest runs tests.

**Tech Stack:** oxlint (linting), oxfmt (formatting), lefthook (git hooks), @commitlint/cli + @commitlint/config-conventional (commit message validation), vitest (test runner)

**Scope:** 2 phases from original design (phase 1 of 2)

**Codebase verified:** 2026-03-03

---

## Acceptance Criteria Coverage

This phase implements and verifies operationally:

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

---

<!-- START_TASK_1 -->

### Task 1: Install dev dependencies

**Files:**

- Modify: `package.json` (devDependencies added by pnpm)
- Modify: `pnpm-lock.yaml` (auto-updated)

**Step 1: Install all dev tooling dependencies**

```bash
pnpm add -D oxlint oxfmt lefthook @commitlint/cli @commitlint/config-conventional vitest @vitest/coverage-v8 fast-check
```

`@vitest/coverage-v8` provides code coverage reporting. `fast-check` enables property-based testing. Both are project-standard test infrastructure per the implementation guidance.

**Step 2: Verify install succeeded**

```bash
pnpm exec oxlint --version && pnpm exec oxfmt --version && pnpm exec lefthook version && pnpm exec commitlint --version && pnpm exec vitest --version
```

Expected: All commands print version numbers without errors.

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add dev tooling dependencies

Install oxlint, oxfmt, lefthook, commitlint, vitest, coverage-v8,
and fast-check as dev dependencies for linting, formatting, git hooks,
and testing."
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create oxlint configuration and add lint script

**Files:**

- Create: `.oxlintrc.json`
- Modify: `package.json` (add `lint` script)

**Step 1: Create `.oxlintrc.json`**

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "rules": {
    "eqeqeq": "error",
    "no-console": "error"
  }
}
```

Only two rules are configured — both enforce behavior that TypeScript's compiler does not cover. `no-unused-vars` is intentionally omitted because `@tsconfig/strictest` already enables `noUnusedLocals` and `noUnusedParameters` at the compiler level (AC4.3).

**Step 2: Add `lint` and `lint:fix` scripts to `package.json`**

Add to the `"scripts"` section:

```json
"lint": "oxlint --deny-warnings src/",
"lint:fix": "oxlint --fix src/"
```

The `lint` script targets `src/` specifically (not the project root) to avoid linting config files and non-source code. `--deny-warnings` treats any warning as an error. `lint:fix` auto-fixes fixable violations.

**Step 3: Verify lint runs clean**

```bash
pnpm lint
```

Expected: Exits 0. The `src/` directory contains only empty `.gitkeep` files and an empty `index.ts`, so there are no lint violations.

**Step 4: Commit**

```bash
git add .oxlintrc.json package.json
git commit -m "build: add oxlint configuration and lint scripts

Configure eqeqeq and no-console as error-level rules. Lint script
targets src/ with --deny-warnings. Add lint:fix for auto-fixing."
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Create oxfmt configuration and add format scripts

**Files:**

- Create: `.oxfmtrc.json`
- Modify: `package.json` (add `format` and `format:check` scripts)

**Step 1: Create `.oxfmtrc.json`**

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 120,
  "ignorePatterns": ["pnpm-lock.yaml", "dist/**"]
}
```

`printWidth` is 120 (oxfmt default is 100). `pnpm-lock.yaml` is already ignored by oxfmt by default since Dec 2025, but including it explicitly is harmless for clarity. `dist/**` excludes compiled output.

**Step 2: Add `format` and `format:check` scripts to `package.json`**

Add to the `"scripts"` section:

```json
"format": "oxfmt --write .",
"format:check": "oxfmt --check ."
```

Both scripts target `.` (project root) to format all supported files (`.ts`, `.json`, `.md`).

**Step 3: Run formatter on all project files**

```bash
pnpm format
```

Expected: oxfmt formats all project files. Some files may be reformatted (e.g., `package.json` indentation, `CLAUDE.md` line wrapping). Review the changes to ensure nothing unexpected.

**Step 4: Verify format check passes**

```bash
pnpm format:check
```

Expected: Exits 0 — all files are now consistently formatted.

**Step 5: Verify format check catches unformatted files (AC3.5)**

Temporarily break formatting to verify the check catches it:

```bash
echo "   const   x   =   1   ;" >> src/index.ts
pnpm format:check
```

Expected: Exits non-zero — `src/index.ts` has formatting issues.

Restore the file:

```bash
git checkout src/index.ts
```

**Step 6: Commit**

```bash
git add .oxfmtrc.json package.json
git add -u
git commit -m "build: add oxfmt configuration and format scripts

Set printWidth to 120, ignore pnpm-lock.yaml and dist. Format all
existing project files to establish consistent baseline."
```

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Add test, test:watch, and typecheck scripts

**Files:**

- Modify: `package.json` (add `test`, `test:watch`, `typecheck` scripts)

**Step 1: Add `test`, `test:watch`, and `typecheck` scripts to `package.json`**

Add to the `"scripts"` section:

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit"
```

`test` runs vitest once and exits. `test:watch` runs vitest in watch mode for development. `typecheck` runs the TypeScript compiler without emitting output to verify type correctness.

**Step 2: Verify vitest runs and exits cleanly**

```bash
pnpm test
```

Expected: vitest runs, finds no test files, and exits 0. Output includes a message like "No test files found" or similar.

If vitest exits non-zero with no test files, add `--passWithNoTests`:

```json
"test": "vitest run --passWithNoTests"
```

**Step 3: Verify typecheck runs**

```bash
pnpm typecheck
```

Expected: Exits 0. TypeScript compiler verifies types without errors (src/index.ts is empty).

**Step 4: Commit**

```bash
git add package.json
git commit -m "build: add test, test:watch, and typecheck scripts

Configure vitest for test runs and watch mode. Add typecheck script
for type verification without emitting output."
```

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: Create commitlint configuration

**Files:**

- Create: `commitlint.config.mjs`

**Step 1: Create `commitlint.config.mjs`**

```javascript
export default {
  extends: ["@commitlint/config-conventional"],
};
```

This extends the conventional commits preset with no custom rules. The `scope-enum` rule is not configured, which means any scope (or no scope) is allowed. This is intentional — the design specifies "no scope-enum."

**Step 2: Verify valid commit message passes**

```bash
echo "feat(tools): add search tool" | pnpm exec commitlint
```

Expected: Exits 0. The message matches `type(scope): description` format.

**Step 3: Verify invalid commit message fails**

```bash
echo "bad message" | pnpm exec commitlint
```

Expected: Exits non-zero. commitlint reports the message does not match conventional commit format (missing type, etc.).

**Step 4: Commit**

```bash
git add commitlint.config.mjs
git commit -m "build: add commitlint configuration

Extend @commitlint/config-conventional to enforce conventional commit
message format. No scope restrictions."
```

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->

### Task 6: Create lefthook configuration, add prepare script, and verify hooks end-to-end

**Files:**

- Create: `lefthook.yml`
- Modify: `package.json` (add `prepare` script)

**Step 1: Create `lefthook.yml`**

```yaml
pre-commit:
  parallel: true
  commands:
    oxfmt:
      glob: "**/*.{ts,json,md}"
      stage_fixed: true
      run: pnpm exec oxfmt --write {staged_files}
    oxlint:
      glob: "**/*.ts"
      run: pnpm exec oxlint --deny-warnings {staged_files}

commit-msg:
  commands:
    commitlint:
      run: pnpm exec commitlint --edit {1}

pre-push:
  commands:
    typecheck:
      run: pnpm typecheck
    test:
      run: pnpm test
```

**How this works:**

- `pre-commit` runs two commands in parallel:
  - `oxfmt` formats staged `.ts`, `.json`, and `.md` files. `stage_fixed: true` automatically re-stages any files that oxfmt modified, so the formatted version is committed (AC2.2).
  - `oxlint` lints staged `.ts` files with `--deny-warnings`, rejecting commits with lint violations.
- `commit-msg` runs commitlint to validate the commit message. `{1}` is replaced by lefthook with the commit message file path (`.git/COMMIT_EDITMSG`).
- `pre-push` runs type checking and tests before pushing. This ensures code that fails type checks or tests cannot be pushed to the remote.

**Step 2: Add `prepare` script to `package.json`**

Add to the `"scripts"` section:

```json
"prepare": "lefthook install"
```

The `prepare` script runs automatically after `pnpm install`. This means anyone who clones the repo and runs `pnpm install` gets git hooks activated without manual setup.

**Step 3: Install lefthook hooks**

```bash
pnpm exec lefthook install
```

Expected: Lefthook installs git hooks into `.git/hooks/`. Output confirms hooks are installed.

**Step 4: Verify pre-commit hook runs (AC2.1)**

```bash
pnpm exec lefthook run pre-commit
```

Expected: Hook executes, running oxfmt and oxlint commands. With no staged files, commands may be skipped — this confirms the hook pipeline is operational.

**Step 5: Verify pre-commit hook auto-restages formatted files (AC2.2)**

Create a temporary file with intentionally bad formatting, stage it, and verify that `stage_fixed: true` causes the formatted version to be re-staged:

```bash
echo 'export   const   x:   number   =   1;' > src/_test_format.ts
git add src/_test_format.ts
pnpm exec lefthook run pre-commit
```

Expected: oxfmt reformats `src/_test_format.ts` and lefthook re-stages the formatted version. After the hook runs, check that the staged content is formatted:

```bash
git diff --cached src/_test_format.ts
```

Expected: The staged file contains the formatted version (e.g., `export const x: number = 1;`), not the original unformatted version.

Clean up:

```bash
git reset HEAD src/_test_format.ts
rm src/_test_format.ts
```

**Step 6: Verify pre-commit hook catches lint errors (AC2.5)**

Create a temporary file with an `==` comparison that violates the `eqeqeq` rule:

```bash
echo 'const x = 1 == 2;' > src/_test_lint.ts
git add src/_test_lint.ts
pnpm exec lefthook run pre-commit
```

Expected: Exits non-zero. oxlint reports an `eqeqeq` error on `src/_test_lint.ts`.

Clean up:

```bash
git reset HEAD src/_test_lint.ts
rm src/_test_lint.ts
```

**Step 7: Verify commit-msg hook rejects bad message (AC2.4)**

Stage the actual files and attempt a commit with an invalid message:

```bash
git add lefthook.yml package.json
git commit -m "bad message"
```

Expected: Commit is **rejected**. The commit-msg hook runs commitlint, which reports the message does not match conventional commit format. Files remain staged.

**Step 8: Commit with valid message (AC2.3)**

```bash
git commit -m "build: add lefthook git hooks and prepare script

Configure pre-commit (oxfmt + oxlint in parallel with stage_fixed),
commit-msg (commitlint), and pre-push (typecheck + test) hooks.
Prepare script runs lefthook install after pnpm install."
```

Expected: Commit **succeeds**. Both the pre-commit hook (formatting/linting the staged `lefthook.yml` and `package.json`) and the commit-msg hook (validating the message format) pass.

<!-- END_TASK_6 -->
