# P3-U09 npm Publish — Test Requirements

## Overview

Maps acceptance criteria from the design plan to verification methods. All phases are infrastructure — verification is operational (commands succeed, files exist), not test-based.

## Automated Verification (CI/Operational)

### AC1: Package configuration

| AC                       | Description                               | Type        | Verification                                  |
| ------------------------ | ----------------------------------------- | ----------- | --------------------------------------------- |
| p3-u09-npm-publish.AC1.1 | `name: "@bojanrajkovic/mcp-paprika"`      | operational | Parse package.json, check name field          |
| p3-u09-npm-publish.AC1.2 | `bin: { "mcp-paprika": "dist/index.js" }` | operational | Parse package.json, check bin field           |
| p3-u09-npm-publish.AC1.3 | `files: ["dist", "README.md", "LICENSE"]` | operational | Parse package.json, check files field         |
| p3-u09-npm-publish.AC1.4 | `publishConfig: { "access": "public" }`   | operational | Parse package.json, check publishConfig field |
| p3-u09-npm-publish.AC1.5 | `license: "MIT"`                          | operational | Parse package.json, check license field       |

### AC2: Build output

| AC                       | Description                                                       | Type        | Verification                          |
| ------------------------ | ----------------------------------------------------------------- | ----------- | ------------------------------------- |
| p3-u09-npm-publish.AC2.1 | `dist/index.js` starts with `#!/usr/bin/env node`                 | operational | `pnpm build && head -1 dist/index.js` |
| p3-u09-npm-publish.AC2.2 | `dist/index.d.ts` exists                                          | operational | `pnpm build && ls dist/index.d.ts`    |
| p3-u09-npm-publish.AC2.3 | `pnpm pack` tarball contains only `dist/`, `README.md`, `LICENSE` | operational | `pnpm pack` + `tar tzf` inspection    |

### AC3: Project files

| AC                       | Description                                                     | Type        | Verification                       |
| ------------------------ | --------------------------------------------------------------- | ----------- | ---------------------------------- |
| p3-u09-npm-publish.AC3.1 | `LICENSE` exists with MIT text                                  | operational | `head -3 LICENSE` shows MIT header |
| p3-u09-npm-publish.AC3.2 | `README.md` exists with name, description, install instructions | operational | `head -5 README.md` shows heading  |

### AC4: Release automation

| AC                       | Description                                            | Type        | Verification                 |
| ------------------------ | ------------------------------------------------------ | ----------- | ---------------------------- |
| p3-u09-npm-publish.AC4.1 | `release-please-config.json` with `release-type: node` | operational | JSON parse + inspect         |
| p3-u09-npm-publish.AC4.2 | `.release-please-manifest.json` tracking version       | operational | JSON parse + inspect         |
| p3-u09-npm-publish.AC4.3 | `release-please.yml` triggers on push to main          | operational | File exists, inspect trigger |
| p3-u09-npm-publish.AC4.4 | `publish.yml` triggers on release creation             | operational | File exists, inspect trigger |

### AC4b: CI compatibility

| AC                        | Description                     | Type        | Verification                               |
| ------------------------- | ------------------------------- | ----------- | ------------------------------------------ |
| p3-u09-npm-publish.AC4b.1 | CI workflow continues to pass   | operational | `pnpm typecheck && pnpm lint && pnpm test` |
| p3-u09-npm-publish.AC4b.2 | Local checks pass after changes | operational | `pnpm typecheck && pnpm lint && pnpm test` |

### AC5: OIDC and security

| AC                       | Description                                       | Type        | Verification                                                     |
| ------------------------ | ------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| p3-u09-npm-publish.AC5.1 | `id-token: write` in publish workflow             | operational | `rg 'id-token: write' .github/workflows/publish.yml`             |
| p3-u09-npm-publish.AC5.2 | `NPM_CONFIG_PROVENANCE: true` in publish workflow | operational | `rg 'NPM_CONFIG_PROVENANCE: true' .github/workflows/publish.yml` |
| p3-u09-npm-publish.AC5.3 | No `NPM_TOKEN` secret referenced                  | operational | `rg NPM_TOKEN .github/workflows/` returns no results             |
| p3-u09-npm-publish.AC5.4 | `cancel-in-progress: false` in publish workflow   | operational | `rg 'cancel-in-progress: false' .github/workflows/publish.yml`   |

## Human Verification

| AC                           | Description                                                | Why Not Automated                                                     | Verification Approach                                                                                               |
| ---------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| p3-u09-npm-publish.AC4.3     | release-please workflow triggers correctly on push to main | Requires actual GitHub Actions execution                              | After merging to main, verify release-please action runs and creates/updates a Release PR                           |
| p3-u09-npm-publish.AC4.4     | publish workflow triggers on release creation              | Requires actual GitHub release event                                  | After merging a Release PR, verify publish workflow runs                                                            |
| p3-u09-npm-publish.AC5.1-5.2 | OIDC authentication and provenance work end-to-end         | Requires npmjs.com trusted publisher configuration and actual publish | Verify first manual publish succeeds, configure trusted publisher, then verify automated publish with OIDC succeeds |
