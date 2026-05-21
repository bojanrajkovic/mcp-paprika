# Releasing

The project ships two artifacts from each release tag:

- **npm package** at `@bojanrajkovic/mcp-paprika` via `publish.yml`
- **Container image** at `ghcr.io/bojanrajkovic/mcp-paprika` via `publish-container.yml` (multi-arch, signed, with SLSA provenance and SPDX SBOM attestations)

Both workflows fire on the same `release: published` event, so npm and the container always ship from the same git tag.

## Release model

Trunk-based, release-please-driven, with optional empirical validation via prerelease container tags.

### Stable releases

1. Commits land on `main` using conventional-commit messages.
2. [release-please-action](https://github.com/googleapis/release-please-action) (run by `release-please.yml` on every push to `main`) opens or updates a release PR with the next version bump and the generated `CHANGELOG.md`.
3. Merging that release PR cuts the GitHub Release at the new tag.
4. `publish.yml` and `publish-container.yml` fire on the published release, building and shipping npm + container with full attestations.

`:latest` on GHCR is updated only for non-prerelease releases, so consumers pulling `ghcr.io/bojanrajkovic/mcp-paprika:latest` always land on a stable version.

### Optional: validate a release candidate before merging

The container workflow also runs for prereleases, which lets you build, sign, and deploy a real candidate image before promoting it to stable:

1. With the release-please PR open (version-bump + changelog visible), tag a prerelease against `main`:

   ```sh
   gh release create v1.2.0-beta.0 \
     --target main \
     --prerelease \
     --notes "Pre-merge validation for 1.2.0"
   ```

2. `publish-container.yml` builds `ghcr.io/bojanrajkovic/mcp-paprika:1.2.0-beta.0`. `:latest` is not touched.
3. Pull and exercise the candidate image in your environment.
4. If it passes: merge the release-please PR. release-please cuts `v1.2.0`, the workflows produce a stable image at `:1.2.0` and roll `:latest`.
5. If it fails: abandon the candidate, fix forward, and tag a new prerelease (`v1.2.0-beta.1`, etc.).

Use a freeze on `main` only for the merge window between "candidate validated" and "release PR merged" — typically minutes, not hours.

### release-please coordination

release-please uses `.release-please-manifest.json` as the source of truth for the current version. Manual prerelease tags created via `gh release create`:

- **Do not** update `.release-please-manifest.json` (no `package.json` bump, no CHANGELOG entry).
- **Do not** affect release-please's commit range when it computes the next release — release-please looks at commits since the manifest version's tag, not at every release tag in the repo.
- **Do** appear in the GitHub Releases list as prereleases. Delete them after validation (see below) to keep the list clean.

The `chore`/`docs` conventional-commit types are hidden from `CHANGELOG.md` via the `changelog-sections` config in `release-please-config.json`. Workflow tweaks, test-only changes, and other internal commits should use those types so they don't surface as user-facing changelog noise.

## Tag conventions

| Tag form                                     | Semantic            | Triggers `publish.yml`?               | Triggers `publish-container.yml`? | Rolls `:latest`? |
| -------------------------------------------- | ------------------- | ------------------------------------- | --------------------------------- | ---------------- |
| `v1.2.0` (release-please cut)                | Stable release      | yes                                   | yes                               | yes              |
| `v1.2.0-beta.0` (manual `--prerelease`)      | RC for validation   | yes — but is gated by package version | yes                               | no               |
| `v0.0.0-smoketest.N` (manual `--prerelease`) | Workflow smoke test | same                                  | yes                               | no               |

Manual prerelease tags should always include a valid [semver prerelease identifier](https://semver.org/#spec-item-9) (`-beta.0`, `-rc.1`, `-smoketest.0`, …) so `docker/metadata-action` parses them correctly into a clean version tag on the image.

## Cleanup after a validation or smoke-test prerelease

```sh
TAG=v1.2.0-beta.0

# Delete the GitHub Release and its git tag in one step
gh release delete "$TAG" --yes --cleanup-tag

# Find and delete the GHCR container version
gh api /user/packages/container/mcp-paprika/versions \
  --jq ".[] | select(.metadata.container.tags[] == \"${TAG#v}\") | .id" \
  | xargs -I{} gh api -X DELETE "/user/packages/container/mcp-paprika/versions/{}"
```

The cosign signature in the public Rekor transparency log persists — Rekor is append-only by design. That entry is just provenance for a dev build; it does not affect anything beyond historical auditability.

## Operational notes

- `publish.yml` fires on every published release including prereleases. The `npm publish` step uses whichever version `package.json` records, so a manual prerelease tag against `main` triggers an attempted re-publish of the current stable version, which npm rejects with a benign "version already exists" error. The workflow run shows as failed in the Actions tab; the npm registry is unaffected.

  If that is operationally annoying, temporarily disable `publish.yml` from the Actions UI before tagging a manual prerelease and re-enable it afterwards — two clicks, fully reversible.

- The container workflow itself only runs on release events. To test PR-branch changes to `publish-container.yml` before merging, tag a synthetic prerelease against the PR branch (`gh release create v0.0.0-smoketest.0 --target <branch> --prerelease`). The release event uses the workflow file at the tagged commit, so PR-branch workflow changes are actually exercised. `workflow_dispatch` doesn't help here for two compounding reasons: the workflow file has to already exist on the default branch to be dispatchable at all (a brand-new workflow on a PR branch returns HTTP 404 from `gh workflow run`), and even for an existing dispatchable workflow GitHub runs the _default-branch definition_ regardless of which `ref` you select for `github.ref` — so PR-branch edits to the workflow body are never the version that executes. The release-event path is the only way to validate workflow changes pre-merge.

- GHCR container packages from a public repo are private at the package level by default. The first push lands as a private package; flip visibility to public in the package settings (one-time, persists for future tags).

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

> **cosign version requirement:** the workflow signs via `sigstore/cosign-installer` (latest), which uses OCI 1.1 referrers to store the signature alongside the image rather than a separate `.sig` tag. `cosign verify` needs a version that supports referrers — **2.5+ works out of the box**, and earlier 2.x versions need `--registry-referrers-mode=oci-1-1`. Older versions report "no signatures found" against an image that is in fact correctly signed. The Docker-run alias is a convenient way to pin the verify-side version: `docker run --rm ghcr.io/sigstore/cosign/cosign:latest verify …`.
