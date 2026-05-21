# Releasing

The project ships two artifacts from each release tag:

- **npm package** at `@bojanrajkovic/mcp-paprika` via `publish.yml`
- **Container image** at `ghcr.io/bojanrajkovic/mcp-paprika` via `publish-container.yml` (multi-arch, signed, with SLSA provenance and SPDX SBOM attestations)

Both workflows fire on `release: published`, so npm and the container always ship from the same git tag.

Prereleases are first-class: tagging a release as prerelease publishes the npm package under a derived dist-tag (`@beta`, `@rc`, `@next`, …) and the container under the matching version tag, without ever updating the `latest` / `:latest` pointers. The published artifacts are permanent — npm versions and GHCR images stay as part of the historical record.

## Release model

Trunk-based, release-please-driven, with optional prerelease tags for pre-merge validation of the container and npm package together.

### Stable releases

1. Commits land on `main` using conventional-commit messages.
2. [release-please-action](https://github.com/googleapis/release-please-action) (run by `release-please.yml` on every push to `main`) opens or updates a release PR with the next version bump and the generated `CHANGELOG.md`.
3. Merging that release PR cuts the GitHub Release at the new tag.
4. `publish.yml` and `publish-container.yml` fire on the published release, building and shipping npm + container with full attestations.

The `latest` pointers — GHCR's `:latest` tag and npm's `latest` dist-tag — update only for non-prerelease releases, so consumers without a pinned version always land on a stable release.

### Validating a release candidate before merging

Both workflows run for prereleases, so a real candidate image and npm package can be built, signed, and exercised before promotion:

1. With the release-please PR open, tag a prerelease against `main`:

   ```sh
   gh release create v1.2.0-beta.0 \
     --target main \
     --prerelease \
     --notes "Pre-merge validation for 1.2.0"
   ```

2. `publish-container.yml` pushes `ghcr.io/bojanrajkovic/mcp-paprika:1.2.0-beta.0` and `publish.yml` publishes `@bojanrajkovic/mcp-paprika@1.2.0-beta.0` under the `@beta` dist-tag. `:latest` and the npm `latest` dist-tag are not touched.
3. Pull the candidate and exercise it (`docker pull ghcr.io/bojanrajkovic/mcp-paprika:1.2.0-beta.0` or `npm install @bojanrajkovic/mcp-paprika@beta`).
4. If it passes: merge the release-please PR. release-please cuts `v1.2.0`, the workflows produce a stable image at `:1.2.0` and the npm `latest` dist-tag rolls to `1.2.0`.
5. If it fails: abandon the candidate, fix forward, tag a new prerelease (`v1.2.0-beta.1`, etc.). The failed candidate stays in the registry as historical record.

Freeze `main` only between "candidate validated" and "release PR merged" — typically minutes.

### release-please coordination

release-please uses `.release-please-manifest.json` as the source of truth for the current version. Manual prerelease tags created via `gh release create`:

- Do not update `.release-please-manifest.json` (no `package.json` bump in main, no CHANGELOG entry). `publish.yml` does an in-workflow `npm version` so the published artifact's version matches the release tag, but that bump never commits back.
- Do not affect release-please's commit range — it looks at commits since the manifest version's tag, not at every release tag in the repo.
- Do appear in the GitHub Releases list as prereleases. They're kept as historical record.

`chore`/`docs` conventional-commit types are hidden from `CHANGELOG.md` via the `changelog-sections` config in `release-please-config.json`. Workflow tweaks, test-only changes, and other internal commits should use those types.

## Tag conventions

| Tag form                                | Semantic          | npm output               | Container output       | Rolls `latest` pointers? |
| --------------------------------------- | ----------------- | ------------------------ | ---------------------- | ------------------------ |
| `v1.2.0` (release-please cut)           | Stable release    | `1.2.0` → `@latest`      | `:1.2.0` and `:latest` | yes                      |
| `v1.2.0-beta.0` (manual `--prerelease`) | RC for validation | `1.2.0-beta.0` → `@beta` | `:1.2.0-beta.0`        | no                       |

Manual prerelease tags should include a valid [semver prerelease identifier](https://semver.org/#spec-item-9) (`-beta.0`, `-rc.1`, …) so `docker/metadata-action` parses them into a clean image version tag, and `publish.yml` derives the npm dist-tag from the leading alpha portion of that identifier. A prerelease without a recognizable identifier (`v1.2.0-0`) falls back to the `@next` dist-tag.

## Operational notes

- To validate PR-branch changes to `publish-container.yml` itself, tag a synthetic prerelease against the PR branch. The release event uses the workflow file at the tagged commit, so the PR-branch version is what executes. `workflow_dispatch` is not a substitute: GitHub runs the default-branch workflow definition regardless of which `ref` you dispatch against, so PR-branch edits to the workflow body are never the version that runs.

- GHCR container packages from a public repo are private at the package level by default. The first push lands as a private package; flip visibility to public in the package settings once (persists for future tags).

## Verifying a published image

Consumers can verify the supply-chain attestations on any published tag:

```sh
TAG=1.2.0

# SLSA build provenance — gh attestation verify defaults to provenance
# only, so SBOM needs an explicit predicate-type to actually check it.
gh attestation verify oci://ghcr.io/bojanrajkovic/mcp-paprika:$TAG \
  --owner bojanrajkovic \
  --predicate-type https://slsa.dev/provenance/v1

# SPDX SBOM
gh attestation verify oci://ghcr.io/bojanrajkovic/mcp-paprika:$TAG \
  --owner bojanrajkovic \
  --predicate-type https://spdx.dev/Document/v2.3

# cosign keyless signature
cosign verify ghcr.io/bojanrajkovic/mcp-paprika:$TAG \
  --certificate-identity-regexp '^https://github\.com/bojanrajkovic/mcp-paprika/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

> **cosign version requirement:** the workflow signs using OCI 1.1 referrers, so `cosign verify` needs cosign 2.5+. Earlier 2.x versions need `--registry-referrers-mode=oci-1-1`; older versions report "no signatures found" against an image that is correctly signed. `docker run --rm ghcr.io/sigstore/cosign/cosign:latest verify …` is a convenient way to pin the verify-side version.

## Deleting a published version (rare)

Published versions are intentionally permanent — both registries persist them as historical record. If you need to delete one anyway (accidental publish, leaked secret in a build), here is the procedure:

```sh
TAG=v1.2.0-beta.0

# GitHub Release + git tag
gh release delete "$TAG" --yes --cleanup-tag

# GHCR container version
gh api /user/packages/container/mcp-paprika/versions \
  --jq ".[] | select(.metadata.container.tags[] == \"${TAG#v}\") | .id" \
  | xargs -I{} gh api -X DELETE "/user/packages/container/mcp-paprika/versions/{}"

# npm package version (only possible within 72 hours of publish, and only
# if the version has no dependents — see npm's unpublish policy)
npm unpublish "@bojanrajkovic/mcp-paprika@${TAG#v}"
```

The cosign signature in the public Rekor transparency log persists regardless — Rekor is append-only by design.
