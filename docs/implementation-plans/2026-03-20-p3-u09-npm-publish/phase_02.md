# P3-U09 npm Publish — Phase 2: Release Automation Workflows

**Goal:** Add release-please configuration and GitHub Actions workflows for automated versioning and npm publishing.

**Architecture:** Two separate GitHub Actions workflows: one for release PR management (release-please), one for npm publishing (triggered by release creation). OIDC trusted publishing eliminates the need for stored NPM_TOKEN secrets.

**Tech Stack:** GitHub Actions, release-please, npm OIDC, pnpm

**Scope:** 2 phases from original design (phase 2 of 2)

**Codebase verified:** 2026-03-20

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### p3-u09-npm-publish.AC4: Release automation

- **p3-u09-npm-publish.AC4.1 Success:** `release-please-config.json` exists with `release-type: node`
- **p3-u09-npm-publish.AC4.2 Success:** `.release-please-manifest.json` exists tracking current version
- **p3-u09-npm-publish.AC4.3 Success:** `.github/workflows/release-please.yml` exists and triggers on push to main
- **p3-u09-npm-publish.AC4.4 Success:** `.github/workflows/publish.yml` exists and triggers on release creation

### p3-u09-npm-publish.AC5: OIDC and security

- **p3-u09-npm-publish.AC5.1 Success:** Publish workflow uses `id-token: write` permission for OIDC
- **p3-u09-npm-publish.AC5.2 Success:** Publish workflow sets `NPM_CONFIG_PROVENANCE: true`
- **p3-u09-npm-publish.AC5.3 Success:** No `NPM_TOKEN` secret is referenced in any workflow
- **p3-u09-npm-publish.AC5.4 Success:** Publish workflow uses `concurrency` with `cancel-in-progress: false`

---

## Context Files

- `/home/brajkovic/Projects/mcp-paprika/.github/workflows/ci.yml` — Existing CI workflow pattern (pinned SHAs, node 24, pnpm with corepack)
- `/home/brajkovic/Projects/mcp-paprika/CLAUDE.md` — Project conventions

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

## Subcomponent A: release-please Configuration

<!-- START_TASK_1 -->

### Task 1: Create `release-please-config.json`

**Verifies:** p3-u09-npm-publish.AC4.1

**Files:**

- Create: `release-please-config.json`

**Implementation:**

Create the release-please configuration file in the project root. This is a single-package (non-monorepo) configuration. The `"."` key means the root package.

Key settings:

- `release-type: "node"` — reads version from package.json, creates changelog
- `bump-minor-pre-major: true` — during 0.x development, `feat` bumps minor (0.1.0 → 0.2.0) not major
- `bump-patch-for-minor-pre-major: true` — during 0.x, `feat` bumps patch instead of minor (more conservative)
- `changelog-sections` — organizes changelog by commit type

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "packages": {
    ".": {
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "changelog-sections": [
        { "type": "feat", "section": "Features" },
        { "type": "fix", "section": "Bug Fixes" },
        { "type": "perf", "section": "Performance" },
        { "type": "refactor", "section": "Refactoring" },
        { "type": "docs", "section": "Documentation", "hidden": true },
        { "type": "chore", "section": "Miscellaneous", "hidden": true }
      ]
    }
  }
}
```

**Verification:**
Run: `node -e "JSON.parse(require('fs').readFileSync('release-please-config.json','utf8')); console.log('valid JSON')"`
Expected: `valid JSON`

**Commit:** `ci: add release-please configuration`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create `.release-please-manifest.json`

**Verifies:** p3-u09-npm-publish.AC4.2

**Files:**

- Create: `.release-please-manifest.json`

**Implementation:**

Create the version manifest file. This tracks the current version of each package. For a single root package, it maps `"."` to the current version in package.json.

The current version in `package.json` is `"0.0.0"`.

```json
{
  ".": "0.0.0"
}
```

**Verification:**
Run: `cat .release-please-manifest.json`
Expected: Shows `{ ".": "0.0.0" }`

**Commit:** `ci: add release-please version manifest`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

## Subcomponent B: GitHub Actions Workflows

<!-- START_TASK_3 -->

### Task 3: Create `.github/workflows/release-please.yml`

**Verifies:** p3-u09-npm-publish.AC4.3

**Files:**

- Create: `.github/workflows/release-please.yml`

**Implementation:**

Create the release-please workflow that runs on every push to `main`. It creates/updates a Release PR with version bumps and changelog. When the Release PR is merged, it creates a GitHub release.

Follow the existing CI workflow pattern from `.github/workflows/ci.yml`:

- Use pinned action SHAs with version comments
- The existing CI uses `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1`

Permissions needed: `contents: write` (to create releases and update files) and `pull-requests: write` (to create/update the Release PR).

```yaml
name: Release Please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    name: Create Release
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@16a9c90856f42705d54a6fda1823352bdc62cf38 # v4.4.0
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

**Notes:**

- This workflow does NOT build or publish. It only manages the Release PR and creates GitHub releases. The publish workflow (Task 4) handles the actual npm publish.
- The pinned SHA `16a9c90856f42705d54a6fda1823352bdc62cf38` corresponds to `release-please-action@v4.4.0`. Verify at execution time: `gh api repos/googleapis/release-please-action/git/refs/tags/v4.4.0 --jq '.object.sha'`

**Verification:**
Run: `cat .github/workflows/release-please.yml`
Expected: Workflow exists with correct trigger, permissions, and release-please action

**Commit:** `ci: add release-please workflow`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Create `.github/workflows/publish.yml`

**Verifies:** p3-u09-npm-publish.AC4.4, p3-u09-npm-publish.AC5.1, p3-u09-npm-publish.AC5.2, p3-u09-npm-publish.AC5.3, p3-u09-npm-publish.AC5.4

**Files:**

- Create: `.github/workflows/publish.yml`

**Implementation:**

Create the npm publish workflow that triggers when a GitHub release is published (created by release-please). Uses OIDC trusted publishing — no NPM_TOKEN secret needed.

Key requirements from ACs:

- `id-token: write` permission (AC5.1) — for OIDC authentication with npm
- `NPM_CONFIG_PROVENANCE: true` (AC5.2) — for supply chain attestation
- No `NPM_TOKEN` secret anywhere (AC5.3)
- `concurrency` with `cancel-in-progress: false` (AC5.4) — prevents canceling a publish mid-way

Follow the existing CI workflow pattern:

- Same pinned action SHAs: `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`
- Same node version: `"24"`
- Same pnpm setup: `corepack enable`, `pnpm install --frozen-lockfile`

**Critical:** `setup-node` must have `registry-url: "https://registry.npmjs.org"` — this is what enables OIDC token generation for npm authentication.

```yaml
name: Publish to npm

on:
  release:
    types: [published]

concurrency:
  group: publish-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    name: Build & Publish
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1

      - run: corepack enable

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: "24"
          cache: pnpm
          registry-url: "https://registry.npmjs.org"

      - run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Publish
        run: npm publish --ignore-scripts
        env:
          NPM_CONFIG_PROVENANCE: true
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Notes on the workflow:**

- Uses `npm publish` instead of `pnpm publish` because npm CLI has proven OIDC trusted publishing support. `pnpm publish` may not pass through the OIDC token exchange correctly (pnpm OIDC support was an open feature request as of mid-2025). `npm` is always available in GitHub Actions runners.
- `--ignore-scripts` prevents npm from running lifecycle scripts (which might expect pnpm-specific behavior)
- `NPM_CONFIG_PROVENANCE: true` as an env var causes npm to include provenance attestation
- `NODE_AUTH_TOKEN` is set to `${{ secrets.GITHUB_TOKEN }}` — this is the OIDC token generated by `setup-node` + `id-token: write`, NOT a stored npm secret. The `setup-node` action with `registry-url` writes an `.npmrc` that references `NODE_AUTH_TOKEN` and injects the OIDC-exchanged token.
- No `NPM_TOKEN` secret is stored or referenced anywhere (AC5.3)
- `cancel-in-progress: false` ensures a publish that starts will always complete

**Important prerequisite — npmjs.com trusted publisher configuration:**
Before the OIDC workflow will work, trusted publishing must be configured on npmjs.com:

1. The package must exist on npm (first publish must be manual: `npm publish --access public` with a personal npm token)
2. After the first publish, go to npmjs.com → package settings → "Trusted Publishers"
3. Add the GitHub repository (`bojanrajkovic/mcp-paprika`), workflow file (`publish.yml`), and optionally an environment name
4. Only after this configuration will OIDC authentication succeed

**Verification:**
Run: `cat .github/workflows/publish.yml`
Expected: Workflow exists with correct trigger, permissions, concurrency, and OIDC config

Run: `rg NPM_TOKEN .github/workflows/ || echo "No NPM_TOKEN found"`
Expected: "No NPM_TOKEN found" (AC5.3) — note: `NODE_AUTH_TOKEN` referencing `secrets.GITHUB_TOKEN` is expected and correct (this is the OIDC token, not a stored npm secret)

**Commit:** `ci: add npm publish workflow with OIDC`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->

### Task 5: Final verification

**Verifies:** p3-u09-npm-publish.AC4.1, p3-u09-npm-publish.AC4.2, p3-u09-npm-publish.AC4.3, p3-u09-npm-publish.AC4.4, p3-u09-npm-publish.AC5.1, p3-u09-npm-publish.AC5.2, p3-u09-npm-publish.AC5.3, p3-u09-npm-publish.AC5.4

**Files:** None (verification only)

**Verification:**

Run: `node -e "JSON.parse(require('fs').readFileSync('release-please-config.json','utf8')); console.log('config OK')"`
Expected: `config OK`

Run: `node -e "JSON.parse(require('fs').readFileSync('.release-please-manifest.json','utf8')); console.log('manifest OK')"`
Expected: `manifest OK`

Run: `ls .github/workflows/release-please.yml .github/workflows/publish.yml`
Expected: Both files exist

Run: `rg 'id-token: write' .github/workflows/publish.yml`
Expected: Match found (AC5.1)

Run: `rg 'NPM_CONFIG_PROVENANCE: true' .github/workflows/publish.yml`
Expected: Match found (AC5.2)

Run: `rg NPM_TOKEN .github/workflows/ || echo "No NPM_TOKEN found"`
Expected: "No NPM_TOKEN found" (AC5.3) — note: `NODE_AUTH_TOKEN` referencing `secrets.GITHUB_TOKEN` is expected (OIDC token, not a stored npm secret)

Run: `rg 'cancel-in-progress: false' .github/workflows/publish.yml`
Expected: Match found (AC5.4)

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass (existing functionality unaffected)

<!-- END_TASK_5 -->
