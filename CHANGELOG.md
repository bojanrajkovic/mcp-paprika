# Changelog

## [1.3.0](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.2.0...v1.3.0) (2026-05-24)


### Features

* **tools:** expose inTrash in update_recipe, add tests for rating/notes/inTrash ([#99](https://github.com/bojanrajkovic/mcp-paprika/issues/99)) ([37a2bef](https://github.com/bojanrajkovic/mcp-paprika/commit/37a2bef47ed12286e0258f0e3b3d8f12c6904ae0))
* **tools:** surface created, rating, isPinned, onGroceryList, onFavorites in recipe outputs ([708fe1d](https://github.com/bojanrajkovic/mcp-paprika/commit/708fe1d3d2d7a1d2c9e450d7327a4b7c74f6fcdc))


### Refactoring

* **cache:** split DiskCache into generic base and per-entity subclasses (issue [#89](https://github.com/bojanrajkovic/mcp-paprika/issues/89)) ([#102](https://github.com/bojanrajkovic/mcp-paprika/issues/102)) ([78b8c11](https://github.com/bojanrajkovic/mcp-paprika/commit/78b8c11e1086456bb3d2dce76abcfcf4bf3f409a))
* **entity:** extract EntityStore abstract base class (issue [#88](https://github.com/bojanrajkovic/mcp-paprika/issues/88)) ([#101](https://github.com/bojanrajkovic/mcp-paprika/issues/101)) ([0ed40b0](https://github.com/bojanrajkovic/mcp-paprika/commit/0ed40b06c65fd09aa07ebbd3672bf58b48054e0f))
* **sync:** unify resource notifications through sync:complete events ([#100](https://github.com/bojanrajkovic/mcp-paprika/issues/100)) ([570849a](https://github.com/bojanrajkovic/mcp-paprika/commit/570849ad209091fd578975258500f9898c153a1d))

## [1.2.0](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.1.0...v1.2.0) (2026-05-23)


### Features

* **http:** add DNS rebinding protection toggles for direct internet exposure ([#93](https://github.com/bojanrajkovic/mcp-paprika/issues/93)) ([f76303b](https://github.com/bojanrajkovic/mcp-paprika/commit/f76303b894354af4aea8e9d81cbc32025649c18e))
* **k8s:** add Kubernetes manifests for self-hosted HTTP deployment ([#84](https://github.com/bojanrajkovic/mcp-paprika/issues/84)) ([c1ff307](https://github.com/bojanrajkovic/mcp-paprika/commit/c1ff3075c924e47cbfdeca099f710ef97864f1f5))
* **logging:** per-tool invocation logs and health probe access-log exclusion ([#97](https://github.com/bojanrajkovic/mcp-paprika/issues/97)) ([e7cac7d](https://github.com/bojanrajkovic/mcp-paprika/commit/e7cac7dedde7eb52abd0cc44062d0c046d6080ef))
* **transport:** add OAuth 2.1 authentication to HTTP transport ([#83](https://github.com/bojanrajkovic/mcp-paprika/issues/83)) ([ea519d9](https://github.com/bojanrajkovic/mcp-paprika/commit/ea519d91dea509e15d482fbbea55e5fd01a7c837))


### Bug Fixes

* **deps:** update dependency @hono/node-server to v1.19.14 ([#79](https://github.com/bojanrajkovic/mcp-paprika/issues/79)) ([9cd2093](https://github.com/bojanrajkovic/mcp-paprika/commit/9cd2093d3e13db2c62e99570df4cb9814dd8afd3))
* **paprika:** retry network-level fetch failures and log write-tool errors ([#95](https://github.com/bojanrajkovic/mcp-paprika/issues/95)) ([8cd823d](https://github.com/bojanrajkovic/mcp-paprika/commit/8cd823dc9618535fdcd9fce1e664eca32e1fe45b))
* **sync:** shield in-flight writes from sync reconciliation race ([#92](https://github.com/bojanrajkovic/mcp-paprika/issues/92)) ([509e6e1](https://github.com/bojanrajkovic/mcp-paprika/commit/509e6e19051a81d7908545073b00ad787de95c7a))

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
