# Changelog

## [1.1.0](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.0.4...v1.1.0) (2026-05-18)


### Features

* add HTTP transport and container image ([#44](https://github.com/bojanrajkovic/mcp-paprika/issues/44)) ([#75](https://github.com/bojanrajkovic/mcp-paprika/issues/75)) ([31d7b5c](https://github.com/bojanrajkovic/mcp-paprika/commit/31d7b5c23d595699e647862fa8088ce1ca21cf18))
* add pantry read support ([#46](https://github.com/bojanrajkovic/mcp-paprika/issues/46)) ([d2635cf](https://github.com/bojanrajkovic/mcp-paprika/commit/d2635cf775c0d13ea92aa07d6ed1424a88e5c691))
* **pantry:** add write support (add/update/delete tools + soft-delete) ([#58](https://github.com/bojanrajkovic/mcp-paprika/issues/58)) ([0fe17fd](https://github.com/bojanrajkovic/mcp-paprika/commit/0fe17fd12c931b1ad909b06b4e9b73508baf5c3a))


### Bug Fixes

* **deps:** update dependency vectra to ^0.14.0 ([#68](https://github.com/bojanrajkovic/mcp-paprika/issues/68)) ([a705231](https://github.com/bojanrajkovic/mcp-paprika/commit/a705231aa240e2b0f975cd188b488b939ea141d6))
* **sync:** coerce null ingredients/directions to empty string ([#77](https://github.com/bojanrajkovic/mcp-paprika/issues/77)) ([d47c5e8](https://github.com/bojanrajkovic/mcp-paprika/commit/d47c5e8a8de160ddd285c34905eb3450efb1c1dd)), closes [#76](https://github.com/bojanrajkovic/mcp-paprika/issues/76)

## [1.0.4](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.0.3...v1.0.4) (2026-05-06)


### Bug Fixes

* **config:** silence dotenv banner to keep stdout clean for MCP stdio ([#54](https://github.com/bojanrajkovic/mcp-paprika/issues/54)) ([ba418c6](https://github.com/bojanrajkovic/mcp-paprika/commit/ba418c63f6cde500dc60934c4e0c3e7f6bf88a8f)), closes [#49](https://github.com/bojanrajkovic/mcp-paprika/issues/49)
* **deps:** update dependency @modelcontextprotocol/sdk to ^1.29.0 ([#41](https://github.com/bojanrajkovic/mcp-paprika/issues/41)) ([0194606](https://github.com/bojanrajkovic/mcp-paprika/commit/019460610fc7a6ecd86bcda7389e95aebdb7ee36))
* **deps:** update dependency dotenv to ^17.4.2 ([#42](https://github.com/bojanrajkovic/mcp-paprika/issues/42)) ([4b8f751](https://github.com/bojanrajkovic/mcp-paprika/commit/4b8f75180e13fbf4f06c72e3aad9bfad206bddc8))
* **deps:** update dependency parse-duration to ^2.1.6 ([#38](https://github.com/bojanrajkovic/mcp-paprika/issues/38)) ([ac61d6b](https://github.com/bojanrajkovic/mcp-paprika/commit/ac61d6be9fcca5303d72c7369b7fd2e9ae05f024))

## [1.0.3](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.0.2...v1.0.3) (2026-03-22)


### Bug Fixes

* add repository field to package.json for npm provenance ([7eae045](https://github.com/bojanrajkovic/mcp-paprika/commit/7eae0453c01508343d0a7c5135c3810902a1f42d))

## [1.0.2](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.0.1...v1.0.2) (2026-03-22)


### Bug Fixes

* **ci:** exclude CHANGELOG.md from oxfmt format checks ([b46bacf](https://github.com/bojanrajkovic/mcp-paprika/commit/b46bacf8231364b15ba89e77e10a96994d582651))
* **ci:** use OIDC trusted publishing and app token for releases ([2f4f2d0](https://github.com/bojanrajkovic/mcp-paprika/commit/2f4f2d0cd812b14f5ef29eea21f2ac9fbeea25d1))

## [1.0.1](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.0.0...v1.0.1) (2026-03-22)


### Bug Fixes

* **ci:** use unprefixed tags for release-please ([f0cce57](https://github.com/bojanrajkovic/mcp-paprika/commit/f0cce57a93511cf3048134454ac11d6d1f7f1b57))
* resilient cold-start check for vector index ([#26](https://github.com/bojanrajkovic/mcp-paprika/issues/26)) ([d594d28](https://github.com/bojanrajkovic/mcp-paprika/commit/d594d282c474244e62eb5dc06f910c7459153ff8))
