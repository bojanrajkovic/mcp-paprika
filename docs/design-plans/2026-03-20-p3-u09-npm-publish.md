# P3-U09 npm Publish Workflow Design

## Summary

This unit configures `mcp-paprika` for distribution as a public npm package and establishes a fully automated release pipeline. On the packaging side, `package.json` gains the scoped package name, a `bin` entry so the server can be run as a CLI command after `npm install -g`, and a `files` allowlist that ensures only compiled output and documentation are shipped — not source, tests, or config. TypeScript is updated to emit declaration files, and a shebang is prepended to the entry point so Node.js treats the compiled file as an executable. A `LICENSE` and `README.md` round out the required project files.

On the automation side, release-please is wired into GitHub Actions to handle the full release lifecycle without manual bookkeeping. Because the project already enforces conventional commits through commitlint, release-please can read commit history directly to compute version bumps and generate a changelog. When commits land on `main`, release-please opens or updates a "Release PR"; merging that PR causes GitHub to create a versioned release, which in turn triggers a separate publish workflow. The publish workflow authenticates to npm via OIDC trusted publishing rather than a stored secret, and enables provenance attestation for supply-chain transparency.

## Definition of Done

Configure `@bojanrajkovic/mcp-paprika` for npm publishing with automated releases. Select and configure a release tool (changesets or release-please), update `package.json` with publish-related fields (`name: @bojanrajkovic/mcp-paprika`, `bin`, `files`, `publishConfig`), add `declaration: true` to tsconfig, add a shebang to the build output, create a LICENSE (MIT) and README.md, and add a GitHub Actions publish workflow using OIDC trusted publishing (no NPM_TOKEN). `pnpm pack` produces a clean tarball with only `dist/`, `README.md`, and `LICENSE`.

## Acceptance Criteria

### p3-u09-npm-publish.AC1: Package configuration

- **p3-u09-npm-publish.AC1.1 Success:** `package.json` has `name: "@bojanrajkovic/mcp-paprika"`
- **p3-u09-npm-publish.AC1.2 Success:** `package.json` has `bin: { "mcp-paprika": "dist/index.js" }`
- **p3-u09-npm-publish.AC1.3 Success:** `package.json` has `files: ["dist", "README.md", "LICENSE"]`
- **p3-u09-npm-publish.AC1.4 Success:** `package.json` has `publishConfig: { "access": "public" }`
- **p3-u09-npm-publish.AC1.5 Success:** `package.json` has `license: "MIT"`

### p3-u09-npm-publish.AC2: Build output

- **p3-u09-npm-publish.AC2.1 Success:** `dist/index.js` starts with `#!/usr/bin/env node`
- **p3-u09-npm-publish.AC2.2 Success:** `dist/index.d.ts` exists (TypeScript declaration files generated)
- **p3-u09-npm-publish.AC2.3 Success:** `pnpm pack` produces a tarball containing only `dist/`, `README.md`, and `LICENSE` (no source, tests, or config files)

### p3-u09-npm-publish.AC3: Project files

- **p3-u09-npm-publish.AC3.1 Success:** `LICENSE` file exists with MIT license text
- **p3-u09-npm-publish.AC3.2 Success:** `README.md` exists with package name, description, and installation instructions

### p3-u09-npm-publish.AC4: Release automation

- **p3-u09-npm-publish.AC4.1 Success:** `release-please-config.json` exists with `release-type: node`
- **p3-u09-npm-publish.AC4.2 Success:** `.release-please-manifest.json` exists tracking current version
- **p3-u09-npm-publish.AC4.3 Success:** `.github/workflows/release-please.yml` exists and triggers on push to main
- **p3-u09-npm-publish.AC4.4 Success:** `.github/workflows/publish.yml` exists and triggers on release creation

### p3-u09-npm-publish.AC4b: CI compatibility

- **p3-u09-npm-publish.AC4b.1 Success:** Existing CI workflow (`ci.yml`) continues to pass with the updated package.json and tsconfig changes
- **p3-u09-npm-publish.AC4b.2 Success:** `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass locally after changes

### p3-u09-npm-publish.AC5: OIDC and security

- **p3-u09-npm-publish.AC5.1 Success:** Publish workflow uses `id-token: write` permission for OIDC
- **p3-u09-npm-publish.AC5.2 Success:** Publish workflow sets `NPM_CONFIG_PROVENANCE: true`
- **p3-u09-npm-publish.AC5.3 Success:** No `NPM_TOKEN` secret is referenced in any workflow
- **p3-u09-npm-publish.AC5.4 Success:** Publish workflow uses `concurrency` with `cancel-in-progress: false`

## Glossary

- **OIDC trusted publishing**: A mechanism that lets GitHub Actions prove its identity to npm using short-lived tokens, eliminating the need to store a long-lived `NPM_TOKEN` secret.
- **npm provenance / `NPM_CONFIG_PROVENANCE`**: An attestation linking the published package to the specific GitHub Actions run and source commit that produced it.
- **Scoped package (`@bojanrajkovic/mcp-paprika`)**: An npm package name prefixed with `@owner/`. Scoped packages are private by default; `publishConfig.access: "public"` overrides this.
- **`bin` field**: A `package.json` field declaring CLI entry points. npm creates symlinks for these in the user's `PATH`.
- **`files` allowlist**: A `package.json` field listing files npm includes in the published tarball. Everything else is excluded.
- **Shebang (`#!/usr/bin/env node`)**: A Unix directive on the first line of a script that tells the OS which interpreter to use.
- **Declaration files (`.d.ts`)**: Auto-generated files describing public types of a compiled TypeScript module.
- **release-please**: A Google-maintained tool that reads conventional commit messages and automates version bumps, changelog generation, and GitHub release creation.
- **Release PR**: A pull request created by release-please that accumulates version bump changes and a generated changelog. Merging it triggers a GitHub release.
- **`release-please-config.json` / `.release-please-manifest.json`**: Configuration and state files for release-please's release type, package name, and current version.
- **`concurrency` with `cancel-in-progress: false`**: A GitHub Actions setting that queues concurrent runs rather than canceling — critical for publish jobs.
- **`pnpm pack`**: Produces a `.tgz` tarball identical to what would be uploaded to npm, used to verify the `files` allowlist.

## Architecture

### Release Tool: release-please

**Decision:** release-please over changesets.

**Rationale:** This project already enforces conventional commits via commitlint. release-please reads commit messages directly to determine version bumps and generate changelogs — zero manual steps beyond writing good commit messages. Changesets would require creating `.changeset/*.md` files per change, adding friction for a solo developer.

**How it works:**

1. Developer merges conventional commits to `main`
2. release-please action creates/updates a "Release PR" with version bump and changelog
3. Developer reviews and merges the Release PR
4. GitHub creates a release, triggering the publish workflow
5. Publish workflow builds and publishes to npm with OIDC

### Workflow Architecture

Two separate GitHub Actions workflows:

**`release-please.yml`** — Runs on every push to `main`

- Uses `googleapis/release-please-action@v4`
- Configured with `release-type: node`
- Creates/updates a Release PR with:
  - Version bump in `package.json`
  - Generated `CHANGELOG.md`
  - Release notes from conventional commits
- When the Release PR is merged, creates a GitHub release

**`publish.yml`** — Triggered by GitHub release creation

- Triggers on `release: types: [published]`
- Checks out the release tag
- Installs dependencies, builds TypeScript
- Publishes to npm using OIDC trusted publishing (no NPM_TOKEN secret)
- Sets `NPM_CONFIG_PROVENANCE: true` for supply chain attestation

### Package Configuration

**package.json updates:**

- `name`: `@bojanrajkovic/mcp-paprika`
- `bin`: `{ "mcp-paprika": "dist/index.js" }` — CLI command after global install
- `files`: `["dist", "README.md", "LICENSE"]` — only ship compiled output + docs
- `publishConfig`: `{ "access": "public" }` — required for scoped packages
- `license`: `"MIT"`

**tsconfig.json:** Add `declaration: true` to generate `.d.ts` files in `dist/`.

**Shebang:** Add `#!/usr/bin/env node` as the first line of `src/index.ts`. TypeScript preserves shebangs at the top of files when compiling.

### New Files

- `LICENSE` — MIT license, 2026, Bojan Rajkovic
- `README.md` — minimal: package name, description, installation, basic usage
- `.github/workflows/release-please.yml` — release PR automation
- `.github/workflows/publish.yml` — npm publish on release
- `release-please-config.json` — release-please configuration
- `.release-please-manifest.json` — tracks current version

## Existing Patterns

### CI Workflow Pattern

The existing `.github/workflows/ci.yml` uses `actions/setup-node@v4.4.0` with `node-version: '24'`, `cache: pnpm`, and `corepack enable`. The publish workflow follows this exact pattern for consistency.

### No Existing Release Infrastructure

No release tools, publish workflows, or changelog generation exist in the project. This design introduces release-please as the first release automation tool.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Package Configuration and Project Files

**Goal:** Prepare the package for npm publishing — update package.json, tsconfig, add shebang, LICENSE, and README.

**Components:**

- `package.json` (modify) — add `name`, `bin`, `files`, `publishConfig`, `license` fields
- `tsconfig.json` (modify) — add `declaration: true`
- `src/index.ts` (modify) — add shebang as first line
- `LICENSE` (create) — MIT license
- `README.md` (create) — minimal package documentation

**Dependencies:** None

**Done when:** `pnpm build` succeeds, `dist/index.js` starts with `#!/usr/bin/env node`, `dist/index.d.ts` exists, `pnpm pack` produces tarball containing only `dist/`, `README.md`, `LICENSE`

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Release Automation Workflows

**Goal:** Add release-please configuration and GitHub Actions workflows for automated versioning and publishing.

**Components:**

- `release-please-config.json` (create) — release-please configuration with `release-type: node` and package name
- `.release-please-manifest.json` (create) — version manifest starting at `0.0.0`
- `.github/workflows/release-please.yml` (create) — release PR automation workflow
- `.github/workflows/publish.yml` (create) — npm publish workflow with OIDC

**Dependencies:** Phase 1 (package configuration must be complete)

**Done when:** Workflow YAML files pass syntax validation, release-please config is valid JSON, CI passes with new workflows present

<!-- END_PHASE_2 -->

## Additional Considerations

**First publish must be manual:** npm OIDC trusted publishing requires the package to already exist on npm. The first release must be published manually with `npm publish --access public` using a personal npm token, after which OIDC trust can be configured on npmjs.com.

**Concurrency protection:** The publish workflow should use `concurrency` with `cancel-in-progress: false` to prevent canceling a publish mid-way, which could leave a partially published package.

**Version 0.x semantics:** During pre-1.0, release-please treats `feat` commits as minor bumps and `fix` as patches. Breaking changes (`feat!` or `BREAKING CHANGE:` footer) will bump to 0.x.0 rather than 1.0.0 while the version is 0.x.y.
