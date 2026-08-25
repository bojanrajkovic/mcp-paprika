# Changelog

## [2.0.0](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.6.0...v2.0.0) (2026-08-25)


### ⚠ BREAKING CHANGES

* **tools:** forward-intent command language for the MCP tool surface ([#219](https://github.com/bojanrajkovic/mcp-paprika/issues/219))

### Features

* add the structured-output channel substrate ([#344](https://github.com/bojanrajkovic/mcp-paprika/issues/344)) ([cc0ce91](https://github.com/bojanrajkovic/mcp-paprika/commit/cc0ce91b518fc1957839ffdbf32882120fca1958))
* add the widget rendering pipeline and kernel UI seam ([#347](https://github.com/bojanrajkovic/mcp-paprika/issues/347)) ([389e1ef](https://github.com/bojanrajkovic/mcp-paprika/commit/389e1ef6805e7194237401c90b9180abb85670b0))
* advertise connector branding (icon, title, website, logo_uri) ([#220](https://github.com/bojanrajkovic/mcp-paprika/issues/220)) ([69be583](https://github.com/bojanrajkovic/mcp-paprika/commit/69be5833e6939e3fe01a41dc3f93d77fa6c58f87))
* **auth:** close confused-deputy gap with redirect-origin allowlist + consent screen ([#193](https://github.com/bojanrajkovic/mcp-paprika/issues/193)) ([55d4274](https://github.com/bojanrajkovic/mcp-paprika/commit/55d42747ec0a302308c1530992eac767a6a3679d))
* convert ensureAisle and ensureMealType to Result ([#269](https://github.com/bojanrajkovic/mcp-paprika/issues/269)) ([03eaa61](https://github.com/bojanrajkovic/mcp-paprika/commit/03eaa613389adc1641be22a8f2a33e789f82e40a))
* convert the disk cache to Result and stop the write path throwing ([#268](https://github.com/bojanrajkovic/mcp-paprika/issues/268)) ([2530995](https://github.com/bojanrajkovic/mcp-paprika/commit/25309953be36486e568f7390b27677a66e306acf))
* convert the feature wrappers and auth runtime to Result, emptying the allowlist ([#271](https://github.com/bojanrajkovic/mcp-paprika/issues/271)) ([769377d](https://github.com/bojanrajkovic/mcp-paprika/commit/769377d90fd2960c58caa93bf3c6aba02a02b898)), closes [#265](https://github.com/bojanrajkovic/mcp-paprika/issues/265)
* convert the paprika client and sync driver to Result ([#270](https://github.com/bojanrajkovic/mcp-paprika/issues/270)) ([daaf45c](https://github.com/bojanrajkovic/mcp-paprika/commit/daaf45cbc4f5ae8afd646e406edf2afb373cbf6c))
* **cooking:** timed mise-en-place prep stage in the cook flow ([#440](https://github.com/bojanrajkovic/mcp-paprika/issues/440)) ([9fabaef](https://github.com/bojanrajkovic/mcp-paprika/commit/9fabaef5bcf306afd13454171c28ff8a25386694))
* **discover:** add an optional minScore relevance cutoff to semantic search ([#190](https://github.com/bojanrajkovic/mcp-paprika/issues/190)) ([a42a115](https://github.com/bojanrajkovic/mcp-paprika/commit/a42a11525c9344bd259bbcbc4922f8bdc5377970))
* **domains:** confirm gates on high-cost destructors ([#364](https://github.com/bojanrajkovic/mcp-paprika/issues/364)) ([18293b1](https://github.com/bojanrajkovic/mcp-paprika/commit/18293b1dc1c22c924c9c772fb13b1a37b084c2ec))
* **domains:** structured output on the catalog/pantry/discover reads ([#355](https://github.com/bojanrajkovic/mcp-paprika/issues/355)) ([ae9cac5](https://github.com/bojanrajkovic/mcp-paprika/commit/ae9cac537f734bf6b9e8fc4fdecf352408aaddde))
* **domains:** structured output on the recipe/grocery/menu list tools ([#354](https://github.com/bojanrajkovic/mcp-paprika/issues/354)) ([dda41ff](https://github.com/bojanrajkovic/mcp-paprika/commit/dda41ff5bf8ba318f7cb09729aad45a1ceac5f18))
* **domains:** structured output on the uid-or-text reads + create/echo tools ([#371](https://github.com/bojanrajkovic/mcp-paprika/issues/371)) ([01dc2b3](https://github.com/bojanrajkovic/mcp-paprika/commit/01dc2b313d720566ece5f833f3cadf80ef42e638))
* establish the neverthrow-in-core convention and its conformance gate ([#267](https://github.com/bojanrajkovic/mcp-paprika/issues/267)) ([0f5d9d2](https://github.com/bojanrajkovic/mcp-paprika/commit/0f5d9d2ed4fad859b4b7fec2ae5509596861b6d9))
* **grocery:** duplicate-ingredient guard with quantity-merge hint on add tools ([#423](https://github.com/bojanrajkovic/mcp-paprika/issues/423)) ([e3bb931](https://github.com/bojanrajkovic/mcp-paprika/commit/e3bb931b68fc04abb4949b28d94fe1d5c5412ec8))
* **grocery:** surface item UIDs in grocery list output ([#302](https://github.com/bojanrajkovic/mcp-paprika/issues/302)) ([226d433](https://github.com/bojanrajkovic/mcp-paprika/commit/226d4334ea2b55ec84ef670c5edf979570d03174))
* **kernel:** precondition-chain defineTool and the tool-surface sweep onto it ([#272](https://github.com/bojanrajkovic/mcp-paprika/issues/272)) ([23bd7b0](https://github.com/bojanrajkovic/mcp-paprika/commit/23bd7b04d3f3534c314294f15400b058426669dd)), closes [#266](https://github.com/bojanrajkovic/mcp-paprika/issues/266)
* **kernel:** thread output-schema type through defineTool ([#396](https://github.com/bojanrajkovic/mcp-paprika/issues/396)) ([c7b5840](https://github.com/bojanrajkovic/mcp-paprika/commit/c7b584041cc324f2a6ce7d9957ce00c752371c70))
* **meal-type:** auto-create custom meal types on first reference ([#248](https://github.com/bojanrajkovic/mcp-paprika/issues/248)) ([4ffdab5](https://github.com/bojanrajkovic/mcp-paprika/commit/4ffdab5c0b1f3816236b9e14363196f25172730f))
* **meal:** divergence-aware createMeals — MealCreateError + schedule_menu commit-only path ([#424](https://github.com/bojanrajkovic/mcp-paprika/issues/424)) ([c95ee44](https://github.com/bojanrajkovic/mcp-paprika/commit/c95ee448a52a6b7d19a2ef6cc45b54b79a8f70dc))
* **meal:** re-expose per-recipe last-cooked via read_recipe_history ([#251](https://github.com/bojanrajkovic/mcp-paprika/issues/251)) ([fc8263c](https://github.com/bojanrajkovic/mcp-paprika/commit/fc8263c9ec3b11b1b043fe7df2102b0df008720b))
* **meal:** structured output on the meal reads ([#352](https://github.com/bojanrajkovic/mcp-paprika/issues/352)) ([bbc6027](https://github.com/bojanrajkovic/mcp-paprika/commit/bbc60277963033302f7ab53f28b65ea56978fc32))
* **menu:** day-sectioned menu widget surfaced from read_menu ([#435](https://github.com/bojanrajkovic/mcp-paprika/issues/435)) ([325dc63](https://github.com/bojanrajkovic/mcp-paprika/commit/325dc63f19eda2e4c9b021ca3e4dae6a9b23fe96))
* **menu:** rich recipe rows in the menu widget ([#438](https://github.com/bojanrajkovic/mcp-paprika/issues/438)) ([7f7c099](https://github.com/bojanrajkovic/mcp-paprika/commit/7f7c099ec882732bc9cbf92ccc59ff186f6b26f2))
* overhaul the documentation system and populate the MCP instructions field ([#198](https://github.com/bojanrajkovic/mcp-paprika/issues/198)) ([76ff7c5](https://github.com/bojanrajkovic/mcp-paprika/commit/76ff7c5805cb1b1e5f1965b91b89af9c7fa96bcb))
* **pantry:** clear_out_of_stock_pantry_items + drawer Clear all ([#425](https://github.com/bojanrajkovic/mcp-paprika/issues/425)) ([055f7b3](https://github.com/bojanrajkovic/mcp-paprika/commit/055f7b3e3561e387ab200a24aa9779f6b0d4824c)), closes [#381](https://github.com/bojanrajkovic/mcp-paprika/issues/381)
* **paprika:** compute recipe content hashes locally for cross-client sync detection ([#191](https://github.com/bojanrajkovic/mcp-paprika/issues/191)) ([571c0b8](https://github.com/bojanrajkovic/mcp-paprika/commit/571c0b8954db3e5a969837c8de08bc6f19d92c4b))
* **photo:** attach a previewed generated photo by token ([#196](https://github.com/bojanrajkovic/mcp-paprika/issues/196)) ([02bbfce](https://github.com/bojanrajkovic/mcp-paprika/commit/02bbfce40bb79a203f7787fc7a1dbc4965813440))
* **recipe:** expose recipe photos via a ui://recipe/{uid}/photo proxy resource ([#427](https://github.com/bojanrajkovic/mcp-paprika/issues/427)) ([f6d3db2](https://github.com/bojanrajkovic/mcp-paprika/commit/f6d3db2d1bf3bb2b57f5bf1f2df67775996db01e))
* **recipe:** give the photo tools structuredContent ([#417](https://github.com/bojanrajkovic/mcp-paprika/issues/417)) ([47bb0dc](https://github.com/bojanrajkovic/mcp-paprika/commit/47bb0dce04e1553430ad34900c7eeee982986277))
* **recipe:** give the recipe write-acks structuredContent ([#414](https://github.com/bojanrajkovic/mcp-paprika/issues/414)) ([464f93c](https://github.com/bojanrajkovic/mcp-paprika/commit/464f93cad284f59ec7a29594c823e8a7e1633345))
* **recipe:** return the attached thumbnail as an image block from upload_recipe_photo ([#361](https://github.com/bojanrajkovic/mcp-paprika/issues/361)) ([2a988ca](https://github.com/bojanrajkovic/mcp-paprika/commit/2a988cac008a1cfd6239b553d74cba4db1248d05))
* reference-catalog management and the remaining sole-surface completeness gaps ([#277](https://github.com/bojanrajkovic/mcp-paprika/issues/277)) ([3845e41](https://github.com/bojanrajkovic/mcp-paprika/commit/3845e4185e0ac285dbddc4c4ae7ceafe01724f3d))
* **shared:** add the fail-open elicitation primitive (confirm + pick) ([#362](https://github.com/bojanrajkovic/mcp-paprika/issues/362)) ([0f987a9](https://github.com/bojanrajkovic/mcp-paprika/commit/0f987a9f04cb7624e351bbaf6bfc254c4666c81f))
* **shared:** wire the disambiguation PICK into the uid-or-text lookup seam ([#363](https://github.com/bojanrajkovic/mcp-paprika/issues/363)) ([a36d3e3](https://github.com/bojanrajkovic/mcp-paprika/commit/a36d3e3dc1e25eef39f493d577b0de1cce0efa88))
* step-anchored cooking widget and cook_recipe tool ([#428](https://github.com/bojanrajkovic/mcp-paprika/issues/428)) ([42d9f11](https://github.com/bojanrajkovic/mcp-paprika/commit/42d9f11ae4c1ca70c81fdc12f5d131b1938cb09c))
* **sync:** add a reference tier for lookup catalogs ([#247](https://github.com/bojanrajkovic/mcp-paprika/issues/247)) ([952a34a](https://github.com/bojanrajkovic/mcp-paprika/commit/952a34a3bac06736bce986cf1a30e0e7b316a306))
* **sync:** make recipe-fetch concurrency configurable ([#192](https://github.com/bojanrajkovic/mcp-paprika/issues/192)) ([b8225ec](https://github.com/bojanrajkovic/mcp-paprika/commit/b8225ec5b87433069840904c04eb26c6b1d154d2))
* **telemetry:** client connection fingerprint + observability logs ([#434](https://github.com/bojanrajkovic/mcp-paprika/issues/434)) ([882d449](https://github.com/bojanrajkovic/mcp-paprika/commit/882d4491020c01e211f5e4980c46788043f8d853))
* **telemetry:** durable widget render-attribution and trace continuity ([#442](https://github.com/bojanrajkovic/mcp-paprika/issues/442)) ([67ab79e](https://github.com/bojanrajkovic/mcp-paprika/commit/67ab79eabe51ba9693832b46fc8f56b93dbb9b77))
* **telemetry:** opt-in OpenTelemetry traces and metrics across the server's seams ([#284](https://github.com/bojanrajkovic/mcp-paprika/issues/284)) ([8666179](https://github.com/bojanrajkovic/mcp-paprika/commit/86661797ff9b176934526773a3b88b9428a1aff8))
* **telemetry:** record caller fingerprint on HTTP request spans ([#444](https://github.com/bojanrajkovic/mcp-paprika/issues/444)) ([1012f19](https://github.com/bojanrajkovic/mcp-paprika/commit/1012f1986bb58d9224c2ab4b5827cfa2c919f693))
* **tools:** add a human-readable title to every tool ([#223](https://github.com/bojanrajkovic/mcp-paprika/issues/223)) ([42c0f7a](https://github.com/bojanrajkovic/mcp-paprika/commit/42c0f7ad6bef9c586cdc66b4d9f054ec0ace4a24))
* **tools:** annotate tools with read-only / destructive / idempotent hints ([#222](https://github.com/bojanrajkovic/mcp-paprika/issues/222)) ([50657e3](https://github.com/bojanrajkovic/mcp-paprika/commit/50657e392e45c532b5fad5b2453d3f2e03970580))
* **tools:** carry schema-bearing tool results as JSON on both channels ([#433](https://github.com/bojanrajkovic/mcp-paprika/issues/433)) ([94ff0d8](https://github.com/bojanrajkovic/mcp-paprika/commit/94ff0d86ca114aa32481c5782e3c4f239a1c2446)), closes [#429](https://github.com/bojanrajkovic/mcp-paprika/issues/429)
* **tools:** give the grocery, pantry, and meal write-acks structuredContent ([#415](https://github.com/bojanrajkovic/mcp-paprika/issues/415)) ([2cfcdc5](https://github.com/bojanrajkovic/mcp-paprika/commit/2cfcdc55a6cf9d9274c68dc5bc6fab5f58de5226))
* **tools:** give the last two text-only-UID creators structuredContent ([#406](https://github.com/bojanrajkovic/mcp-paprika/issues/406)) ([4a7fc7d](https://github.com/bojanrajkovic/mcp-paprika/commit/4a7fc7d2f30e5f51d4701b35c957f805e696be12))
* **tools:** give the meal creators and pantry mover structuredContent ([#411](https://github.com/bojanrajkovic/mcp-paprika/issues/411)) ([50f67f9](https://github.com/bojanrajkovic/mcp-paprika/commit/50f67f92d67f3c78ea6a9ee2e95dcdc5e7566ca9))
* **tools:** give the menu and catalog write-acks structuredContent ([#416](https://github.com/bojanrajkovic/mcp-paprika/issues/416)) ([ebef106](https://github.com/bojanrajkovic/mcp-paprika/commit/ebef106af9ea5cff397bf7ccb5f7d56d5c99271c))
* **tools:** route uid-or-text lookup non-happy-paths to isError + findWith ([#366](https://github.com/bojanrajkovic/mcp-paprika/issues/366)) ([f399e30](https://github.com/bojanrajkovic/mcp-paprika/commit/f399e30d6cc221f254380e38089a3fa5b195fc66))
* **widgets:** add the meal-week-planner widget ([#421](https://github.com/bojanrajkovic/mcp-paprika/issues/421)) ([4dcc999](https://github.com/bojanrajkovic/mcp-paprika/commit/4dcc99940a12d1adea525a8e6792a06c6b023a4f))
* **widgets:** add the recipe-browser widget ([#422](https://github.com/bojanrajkovic/mcp-paprika/issues/422)) ([0754c8d](https://github.com/bojanrajkovic/mcp-paprika/commit/0754c8d744ab6c4f3bc72ce77dbc471cea580930))
* **widgets:** externalize the ext-apps vendor runtime ([#443](https://github.com/bojanrajkovic/mcp-paprika/issues/443)) ([2b79e06](https://github.com/bojanrajkovic/mcp-paprika/commit/2b79e06c9d1c119da64502750dcdb6e4d3e0993b))
* **widgets:** grocery checklist "Move N → pantry" header action ([#426](https://github.com/bojanrajkovic/mcp-paprika/issues/426)) ([fadc2b6](https://github.com/bojanrajkovic/mcp-paprika/commit/fadc2b69c33cdec7d5314f13556257544a277604))
* **widgets:** grocery purchased-checklist widget ([c055884](https://github.com/bojanrajkovic/mcp-paprika/commit/c0558840b79ffe471f8e3d51d00c9aa7e89a8b66)), closes [#329](https://github.com/bojanrajkovic/mcp-paprika/issues/329) [#330](https://github.com/bojanrajkovic/mcp-paprika/issues/330) [#331](https://github.com/bojanrajkovic/mcp-paprika/issues/331) [#332](https://github.com/bojanrajkovic/mcp-paprika/issues/332)
* **widgets:** pantry inventory checklist widget ([#382](https://github.com/bojanrajkovic/mcp-paprika/issues/382)) ([7f0254b](https://github.com/bojanrajkovic/mcp-paprika/commit/7f0254b07675664fe4849720eb308889b6a9f30e))
* **widgets:** shared toolkit + the widget design system ([#386](https://github.com/bojanrajkovic/mcp-paprika/issues/386)) ([1c6a4bd](https://github.com/bojanrajkovic/mcp-paprika/commit/1c6a4bdd3c5d6600413483df3071cee445753e95))


### Bug Fixes

* **auth:** bound the in-memory auth stores against /authorize floods ([#194](https://github.com/bojanrajkovic/mcp-paprika/issues/194)) ([04b64ad](https://github.com/bojanrajkovic/mcp-paprika/commit/04b64ad0232066154def9519b7d9e8105aa1a574))
* **auth:** unblock the consent approve flow and polish the consent page ([#221](https://github.com/bojanrajkovic/mcp-paprika/issues/221)) ([fb0f7f2](https://github.com/bojanrajkovic/mcp-paprika/commit/fb0f7f2ecce136433dccfdc6f32297c2e602e667))
* **config:** treat __proto__ override keys as data in deepMerge ([#346](https://github.com/bojanrajkovic/mcp-paprika/issues/346)) ([9d648a3](https://github.com/bojanrajkovic/mcp-paprika/commit/9d648a3ca673cb50d42772780acb3edb9e4533c2)), closes [#345](https://github.com/bojanrajkovic/mcp-paprika/issues/345)
* **deps:** update dependency @hono/mcp to v0.3.0 ([#283](https://github.com/bojanrajkovic/mcp-paprika/issues/283)) ([af20e76](https://github.com/bojanrajkovic/mcp-paprika/commit/af20e761e2a790d0203c7036d9b097e3e8d7d99a))
* **deps:** update dependency @hono/mcp to v0.3.1 ([#451](https://github.com/bojanrajkovic/mcp-paprika/issues/451)) ([e404919](https://github.com/bojanrajkovic/mcp-paprika/commit/e404919f5b1f6c111a3bfa5c304c7af9daaebddf))
* **deps:** update dependency @hono/node-server to v2.0.12 ([#453](https://github.com/bojanrajkovic/mcp-paprika/issues/453)) ([49f688e](https://github.com/bojanrajkovic/mcp-paprika/commit/49f688e0b771bfb4df237fc5a73e0a89f2d5b7a8))
* **deps:** update dependency @hono/node-server to v2.0.5 ([#405](https://github.com/bojanrajkovic/mcp-paprika/issues/405)) ([efc41c5](https://github.com/bojanrajkovic/mcp-paprika/commit/efc41c5b43d1160d17e97d1a6ccfb26e84301fb4))
* **deps:** update dependency @hono/node-server to v2.0.6 ([#448](https://github.com/bojanrajkovic/mcp-paprika/issues/448)) ([d1f860c](https://github.com/bojanrajkovic/mcp-paprika/commit/d1f860c9d63cc906e1269f02c618a20be24a7f1d))
* **deps:** update dependency @hono/node-server to v2.0.8 ([#449](https://github.com/bojanrajkovic/mcp-paprika/issues/449)) ([67604c6](https://github.com/bojanrajkovic/mcp-paprika/commit/67604c649eb8d8d97aa5a0168609cafd668321f0))
* **deps:** update dependency cockatiel to v4 ([#287](https://github.com/bojanrajkovic/mcp-paprika/issues/287)) ([60875b8](https://github.com/bojanrajkovic/mcp-paprika/commit/60875b8495e2e24a402297f0577f996c9329dcfd))
* **deps:** update dependency hono to v4.12.24 ([#294](https://github.com/bojanrajkovic/mcp-paprika/issues/294)) ([7e103e2](https://github.com/bojanrajkovic/mcp-paprika/commit/7e103e2032ec54c0c66085b594f64f546c19b2a7))
* **deps:** update dependency hono to v4.12.26 ([#408](https://github.com/bojanrajkovic/mcp-paprika/issues/408)) ([cce8b7f](https://github.com/bojanrajkovic/mcp-paprika/commit/cce8b7f9b27a909addf543ca544278340dfbde39))
* **deps:** update dependency hono to v4.12.27 ([#450](https://github.com/bojanrajkovic/mcp-paprika/issues/450)) ([ac9209d](https://github.com/bojanrajkovic/mcp-paprika/commit/ac9209d9c551ee1645be18907a2d0757319219fd))
* **deps:** update dependency hono to v4.12.30 ([#452](https://github.com/bojanrajkovic/mcp-paprika/issues/452)) ([e71ddc3](https://github.com/bojanrajkovic/mcp-paprika/commit/e71ddc3cc8afe606f2414ec23f213345f8e1e527))
* **deps:** update dependency hono to v4.12.33 ([#455](https://github.com/bojanrajkovic/mcp-paprika/issues/455)) ([e551cf5](https://github.com/bojanrajkovic/mcp-paprika/commit/e551cf55b1363b424485730e4d124eea6a72d8ac))
* **deps:** update dependency jose to ^6.2.4 ([#454](https://github.com/bojanrajkovic/mcp-paprika/issues/454)) ([87813d3](https://github.com/bojanrajkovic/mcp-paprika/commit/87813d3ccdebab2f8913e5dfe3ae1d8b5d6f9ee6))
* **deps:** update dependency jose to ^6.2.7 ([#456](https://github.com/bojanrajkovic/mcp-paprika/issues/456)) ([08bebd6](https://github.com/bojanrajkovic/mcp-paprika/commit/08bebd6a7702b664de0daee63b300cf3e90daa16))
* **deps:** update dependency jose to ^6.2.8 ([#459](https://github.com/bojanrajkovic/mcp-paprika/issues/459)) ([53d46a4](https://github.com/bojanrajkovic/mcp-paprika/commit/53d46a4050a7fcfba3176309b638191afdff0073))
* **deps:** update dependency jose to ^6.2.9 ([#461](https://github.com/bojanrajkovic/mcp-paprika/issues/461)) ([ecd76c9](https://github.com/bojanrajkovic/mcp-paprika/commit/ecd76c908805ba700591f392d8a60a9ce98414e5))
* **deps:** update dependency parse-duration to ^2.1.8 ([#457](https://github.com/bojanrajkovic/mcp-paprika/issues/457)) ([c1a65c9](https://github.com/bojanrajkovic/mcp-paprika/commit/c1a65c95042e31abfda8ff19587cb35596ecf3d7))
* **deps:** update dependency sharp to ^0.35.1 ([#299](https://github.com/bojanrajkovic/mcp-paprika/issues/299)) ([5c1b02c](https://github.com/bojanrajkovic/mcp-paprika/commit/5c1b02cdd46d1a426971fc610b1973fa0caadc94))
* **deps:** update dependency sharp to ^0.35.2 ([#409](https://github.com/bojanrajkovic/mcp-paprika/issues/409)) ([205818c](https://github.com/bojanrajkovic/mcp-paprika/commit/205818c53e7ed396f62c654a63a1fba8b62c430d))
* **deps:** update dependency sharp to ^0.35.3 ([#458](https://github.com/bojanrajkovic/mcp-paprika/issues/458)) ([c003d3a](https://github.com/bojanrajkovic/mcp-paprika/commit/c003d3afd826824683637303c22ba88a4551279b))
* **deps:** update dependency undici to ^8.4.0 ([#285](https://github.com/bojanrajkovic/mcp-paprika/issues/285)) ([22e720d](https://github.com/bojanrajkovic/mcp-paprika/commit/22e720dce22fcccbd56df92bb6cfdf418f5422e2))
* **deps:** update dependency undici to ^8.4.1 ([#295](https://github.com/bojanrajkovic/mcp-paprika/issues/295)) ([bc6de0f](https://github.com/bojanrajkovic/mcp-paprika/commit/bc6de0f864c3cf28a5dc4eb2b9953e6f71b35277))
* **deps:** update opentelemetry-js monorepo ([#300](https://github.com/bojanrajkovic/mcp-paprika/issues/300)) ([5c870ff](https://github.com/bojanrajkovic/mcp-paprika/commit/5c870fff1f0bf10b2ceaee490d9b2b6f79d21bb2))
* **deps:** update opentelemetry-js-contrib monorepo ([#301](https://github.com/bojanrajkovic/mcp-paprika/issues/301)) ([35eb8a8](https://github.com/bojanrajkovic/mcp-paprika/commit/35eb8a883eb2ae3424a301a5dcc40726312fce94))
* **discover:** maintain vector index on local writes and category renames ([#186](https://github.com/bojanrajkovic/mcp-paprika/issues/186)) ([c36b352](https://github.com/bojanrajkovic/mcp-paprika/commit/c36b352370dc613fb31d411ff04f4140c9996a71))
* **grocery:** have buildGroceryItems signal failure with errorResult ([#394](https://github.com/bojanrajkovic/mcp-paprika/issues/394)) ([6068d8b](https://github.com/bojanrajkovic/mcp-paprika/commit/6068d8ba831ef3f2d81a2e64ec6ef48954078a51))
* **meal:** tolerate null/missing fields in meal wire rows ([#292](https://github.com/bojanrajkovic/mcp-paprika/issues/292)) ([c68ec01](https://github.com/bojanrajkovic/mcp-paprika/commit/c68ec013086200b9d1f2ec5542db2fd573633248))
* **shared:** thread logger into resolveOrPick / formatLookupOutcome ([#389](https://github.com/bojanrajkovic/mcp-paprika/issues/389)) ([f3e8292](https://github.com/bojanrajkovic/mcp-paprika/commit/f3e829247222d1546f96f369b4d720c7691c457c)), closes [#376](https://github.com/bojanrajkovic/mcp-paprika/issues/376)
* **tools:** add discovery-verb hints to not-found mutator errors ([#388](https://github.com/bojanrajkovic/mcp-paprika/issues/388)) ([406ba58](https://github.com/bojanrajkovic/mcp-paprika/commit/406ba580151e0418f1a7c192711f52674a5091cc)), closes [#365](https://github.com/bojanrajkovic/mcp-paprika/issues/365)
* **tools:** render the recipe UID in recipe markdown ([#195](https://github.com/bojanrajkovic/mcp-paprika/issues/195)) ([457e87b](https://github.com/bojanrajkovic/mcp-paprika/commit/457e87b4b6fb9cfd3762f373fa5feff6b959fd24))
* **widgets:** elicitation-aware confirm on grocery checklist ([#392](https://github.com/bojanrajkovic/mcp-paprika/issues/392)) ([1f66784](https://github.com/bojanrajkovic/mcp-paprika/commit/1f66784a56493f17f28647b5e6bdfbe0c29baf17))
* **widgets:** replace done-row strikethrough with opacity curtain ([f487d04](https://github.com/bojanrajkovic/mcp-paprika/commit/f487d04491ff671d072a3f5482bd95cc36925642)), closes [#385](https://github.com/bojanrajkovic/mcp-paprika/issues/385)


### Refactoring

* **dates:** consolidate and rename date/time helpers ([#184](https://github.com/bojanrajkovic/mcp-paprika/issues/184)) ([c78b803](https://github.com/bojanrajkovic/mcp-paprika/commit/c78b803196d94453f97a02f823570a37ec29d043)), closes [#153](https://github.com/bojanrajkovic/mcp-paprika/issues/153)
* **discover:** vendor a minimal vector index, dropping the vectra stack ([#189](https://github.com/bojanrajkovic/mcp-paprika/issues/189)) ([26bf688](https://github.com/bojanrajkovic/mcp-paprika/commit/26bf688db06c40b8d224f87d4c3914bae0f1fe08))
* domain-isolated modules over a typed composition kernel ([#227](https://github.com/bojanrajkovic/mcp-paprika/issues/227)) ([817eda3](https://github.com/bojanrajkovic/mcp-paprika/commit/817eda352d840c2400ba27ac439d959f5210356c))
* **domains:** distribute branded-UID leafs into owning domains ([#274](https://github.com/bojanrajkovic/mcp-paprika/issues/274)) ([5eb2931](https://github.com/bojanrajkovic/mcp-paprika/commit/5eb29317d19f3cd966f57099255ec9bc5163cd5e))
* **entity:** dedup the commit chokepoints behind a shared commit-protocol helper ([#275](https://github.com/bojanrajkovic/mcp-paprika/issues/275)) ([cff94a3](https://github.com/bojanrajkovic/mcp-paprika/commit/cff94a365d0ff88148356487ff0bdc0fe62ab370))
* **ids:** enforce non-empty UID brands and explicit absent-FK sentinels ([#218](https://github.com/bojanrajkovic/mcp-paprika/issues/218)) ([b98f499](https://github.com/bojanrajkovic/mcp-paprika/commit/b98f4996931b927cbecfdc1316f3eb02790e04a2))
* **kernel:** map ToolSpec into the registerTool config explicitly ([#342](https://github.com/bojanrajkovic/mcp-paprika/issues/342)) ([bd8a959](https://github.com/bojanrajkovic/mcp-paprika/commit/bd8a9593b13ecdb16a556a47bd09b348ed968c73))
* **kernel:** mark precondition-gate failures isError in the kernel ([#359](https://github.com/bojanrajkovic/mcp-paprika/issues/359)) ([90af787](https://github.com/bojanrajkovic/mcp-paprika/commit/90af787de08aed363d3bb9c6708b7b11ca32f67e))
* **kernel:** register resources as data via defineResource ([#439](https://github.com/bojanrajkovic/mcp-paprika/issues/439)) ([6320bcc](https://github.com/bojanrajkovic/mcp-paprika/commit/6320bcc803d44caa7603cf0d0f3903d8213890ee))
* **kernel:** thread declared deps into module .build and route cross-domain builders through the dep-aware APIs ([#418](https://github.com/bojanrajkovic/mcp-paprika/issues/418)) ([f0eb0d9](https://github.com/bojanrajkovic/mcp-paprika/commit/f0eb0d96db0d2fb40a02df4650901fbca60b2369))
* **kernel:** tidy module contracts — EmptyApi, HasSynced, fewer exports ([#256](https://github.com/bojanrajkovic/mcp-paprika/issues/256)) ([290c68d](https://github.com/bojanrajkovic/mcp-paprika/commit/290c68dccb1792850efe854832f865ea41a7e652))
* move test fixtures and helpers out of src into test/ ([#217](https://github.com/bojanrajkovic/mcp-paprika/issues/217)) ([3dd48b8](https://github.com/bojanrajkovic/mcp-paprika/commit/3dd48b8f304697fbe4e92fdeb2d1b248bf3a97bb))
* **pantry:** align list_pantry_items aisle to live catalog ([#393](https://github.com/bojanrajkovic/mcp-paprika/issues/393)) ([0ed69bc](https://github.com/bojanrajkovic/mcp-paprika/commit/0ed69bcb991dfa9e6a424316be1525523dd0b1b6))
* phased composition root, per-domain modules, and branded foreign keys ([#203](https://github.com/bojanrajkovic/mcp-paprika/issues/203)) ([f770fbd](https://github.com/bojanrajkovic/mcp-paprika/commit/f770fbd4e7f656d16ffad034baba85071a8a48d6))
* purify module *State behind a ctx.writes seam, sweep registrar/contract docs ([#254](https://github.com/bojanrajkovic/mcp-paprika/issues/254)) ([8db2ccd](https://github.com/bojanrajkovic/mcp-paprika/commit/8db2ccd4b790f4f9f52cbeeb016c078ba66c711d))
* **recipe:** drop the legacy unified-index migration ([#276](https://github.com/bojanrajkovic/mcp-paprika/issues/276)) ([2f861dc](https://github.com/bojanrajkovic/mcp-paprika/commit/2f861dc85e150f1ed4d84a7362ab3cd91612d593))
* remove DiskCacheRoot and co-locate auth persistence in src/auth/ ([#252](https://github.com/bojanrajkovic/mcp-paprika/issues/252)) ([758cfd7](https://github.com/bojanrajkovic/mcp-paprika/commit/758cfd787f17ce7f6488112263d2687ad6a81e4b))
* settle the per-domain file-granularity convention ([#258](https://github.com/bojanrajkovic/mcp-paprika/issues/258)) ([36e35e1](https://github.com/bojanrajkovic/mcp-paprika/commit/36e35e1d7ee9698470158fc9c1d720c8f709084b))
* **shared:** fix double-resolve in schema-bearing reads ([#395](https://github.com/bojanrajkovic/mcp-paprika/issues/395)) ([f718aa4](https://github.com/bojanrajkovic/mcp-paprika/commit/f718aa42462e4fc47c571e5939886b206d30d4ab))
* spec-as-data tool registration, boot-free reference generator ([#253](https://github.com/bojanrajkovic/mcp-paprika/issues/253)) ([6c097b0](https://github.com/bojanrajkovic/mcp-paprika/commit/6c097b01678878498df38e67d4a1788111f53a95))
* **sync:** derive change-detection equality from Zod schemas ([#257](https://github.com/bojanrajkovic/mcp-paprika/issues/257)) ([b845f07](https://github.com/bojanrajkovic/mcp-paprika/commit/b845f07497fddef6c0a83a60b43cc8160a263e3d))
* **tools:** forward-intent command language for the MCP tool surface ([#219](https://github.com/bojanrajkovic/mcp-paprika/issues/219)) ([b65c193](https://github.com/bojanrajkovic/mcp-paprika/commit/b65c193bf301f49a722ef63298efe40fd6fe9d8d))
* **tools:** strip the redundant top-level UID lines from the read formatters ([#407](https://github.com/bojanrajkovic/mcp-paprika/issues/407)) ([4ce72c3](https://github.com/bojanrajkovic/mcp-paprika/commit/4ce72c378c9190d018346cc3f7df7b63c28e26f5))
* **widgets:** bind widget guards to the server's shared output types ([#445](https://github.com/bojanrajkovic/mcp-paprika/issues/445)) ([70123dc](https://github.com/bojanrajkovic/mcp-paprika/commit/70123dc981ca7ca732afc4864b8c4b211c0d500f))
* **widgets:** centralize focus ring + reduced-motion CSS in WidgetShell ([#432](https://github.com/bojanrajkovic/mcp-paprika/issues/432)) ([7e83a51](https://github.com/bojanrajkovic/mcp-paprika/commit/7e83a514dafd60f316e32f75c4942ce5528678c6))
* **widgets:** centralize the native button reset in WidgetShell ([#437](https://github.com/bojanrajkovic/mcp-paprika/issues/437)) ([53a737d](https://github.com/bojanrajkovic/mcp-paprika/commit/53a737d57fdf835c81e1828798f8d70c797f9475))
* **widgets:** extract the row/disclosure chevron to a shared component ([#436](https://github.com/bojanrajkovic/mcp-paprika/issues/436)) ([cc32f0e](https://github.com/bojanrajkovic/mcp-paprika/commit/cc32f0e9ccd5caf1b109499c8e21b219022f1e59))

## [1.6.0](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.5.0...v1.6.0) (2026-05-31)


### Features

* **category:** add category CRUD tools and dedicated CategoryStore ([#176](https://github.com/bojanrajkovic/mcp-paprika/issues/176)) ([748f2db](https://github.com/bojanrajkovic/mcp-paprika/commit/748f2db514ed58e5781b893a200f7c3629f49272))
* **photo:** add generate_photo tool for AI recipe photos ([#180](https://github.com/bojanrajkovic/mcp-paprika/issues/180)) ([bb76157](https://github.com/bojanrajkovic/mcp-paprika/commit/bb76157cf7cc872b481eb763411a01b4dc7ed1e7))
* **photos:** add photo read/sync scaffolding (PhotoSchema, PhotoStore, photos sync) ([#171](https://github.com/bojanrajkovic/mcp-paprika/issues/171)) ([e253105](https://github.com/bojanrajkovic/mcp-paprika/commit/e2531056a993f4304e312a5ef3012b132364aad0))
* **photos:** add upload_photo and delete_photo write tools ([#172](https://github.com/bojanrajkovic/mcp-paprika/issues/172)) ([27cc598](https://github.com/bojanrajkovic/mcp-paprika/commit/27cc59825d930e819fbeff109556c194d2ba5cd6))
* **recipe:** add empty_trash tool for permanent recipe deletion ([#165](https://github.com/bojanrajkovic/mcp-paprika/issues/165)) ([7c5a78c](https://github.com/bojanrajkovic/mcp-paprika/commit/7c5a78c8c01e0c807f00359c2d4f7cfd490dce33))


### Bug Fixes

* **category:** render orphaned categories in list_categories instead of hiding them ([#179](https://github.com/bojanrajkovic/mcp-paprika/issues/179)) ([ae4233d](https://github.com/bojanrajkovic/mcp-paprika/commit/ae4233d5f5e4e089a5bab35954c8272d297160ee))
* **paprika:** treat Paprika's HTTP 200 {error} envelope as a failure ([#182](https://github.com/bojanrajkovic/mcp-paprika/issues/182)) ([b266e23](https://github.com/bojanrajkovic/mcp-paprika/commit/b266e23afd6921af82965d4129073049b4b1f8a1))
* **photo:** use undici's fetch for the SSRF-dispatched image download ([#181](https://github.com/bojanrajkovic/mcp-paprika/issues/181)) ([f6a165d](https://github.com/bojanrajkovic/mcp-paprika/commit/f6a165d4a2560fb809dea2a6253e961ec01b20bd))


### Refactoring

* **test:** centralize AppContext construction in makeAppContext factory ([#170](https://github.com/bojanrajkovic/mcp-paprika/issues/170)) ([8a55182](https://github.com/bojanrajkovic/mcp-paprika/commit/8a55182ef960e1bb61349736d1dc8b04e89b3dc7))

## [1.5.0](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.4.0...v1.5.0) (2026-05-31)


### Features

* **meals:** add add_menu_to_planner; fix order_flag to per-date ([#152](https://github.com/bojanrajkovic/mcp-paprika/issues/152)) ([d3ac991](https://github.com/bojanrajkovic/mcp-paprika/commit/d3ac991216819f24ff82e372627b10b0260ff16c)), closes [#137](https://github.com/bojanrajkovic/mcp-paprika/issues/137)
* **meals:** add list_meal_types read tool ([#146](https://github.com/bojanrajkovic/mcp-paprika/issues/146)) ([8aa26c1](https://github.com/bojanrajkovic/mcp-paprika/commit/8aa26c111da741164f957e504606e496cb7ecec1)), closes [#135](https://github.com/bojanrajkovic/mcp-paprika/issues/135)
* **meals:** add_meals / update_meal / delete_meal — meal-planner write tools ([#143](https://github.com/bojanrajkovic/mcp-paprika/issues/143)) ([ba66e60](https://github.com/bojanrajkovic/mcp-paprika/commit/ba66e60bd678d88ed3bd1e60ce23c046de6eaadc))
* **meals:** read-only meal history via MCP ([#133](https://github.com/bojanrajkovic/mcp-paprika/issues/133)) ([b51f69c](https://github.com/bojanrajkovic/mcp-paprika/commit/b51f69ca49e67dcf45fdaffe6830ca1f1f30b7da))
* **menus:** add add_menu_items / update_menu_item / delete_menu_item tools ([#150](https://github.com/bojanrajkovic/mcp-paprika/issues/150)) ([df5089b](https://github.com/bojanrajkovic/mcp-paprika/commit/df5089be7fe77899deb7b9bac111c8b08e37e28d))
* **menus:** add create_menu / update_menu / delete_menu tools ([#151](https://github.com/bojanrajkovic/mcp-paprika/issues/151)) ([8263655](https://github.com/bojanrajkovic/mcp-paprika/commit/82636556475690e202c5ac628bd546bd87ed0e5b))
* **menus:** add menu read surface, stores, and sync scaffolding ([#148](https://github.com/bojanrajkovic/mcp-paprika/issues/148)) ([39e347b](https://github.com/bojanrajkovic/mcp-paprika/commit/39e347b4f96c8817550783bc1cb5132a6a2a9d91))
* **menus:** support freeform menuitems in add_menu_items ([#161](https://github.com/bojanrajkovic/mcp-paprika/issues/161)) ([5d7de20](https://github.com/bojanrajkovic/mcp-paprika/commit/5d7de20da8fd8a4e09cfd9b591654e80564018ac))


### Bug Fixes

* **auth:** retry startup authentication on transient failures ([#163](https://github.com/bojanrajkovic/mcp-paprika/issues/163)) ([d18bbd2](https://github.com/bojanrajkovic/mcp-paprika/commit/d18bbd2ae034fef7fc35ff4e0720e9d8fd192ed9)), closes [#158](https://github.com/bojanrajkovic/mcp-paprika/issues/158)
* **capture:** remove spurious double-nesting from wire capture POST bodies ([a825af7](https://github.com/bojanrajkovic/mcp-paprika/commit/a825af71a762c22a90890321caaede6cbeafc8f2)), closes [#129](https://github.com/bojanrajkovic/mcp-paprika/issues/129)
* **filter:** parse "+"-suffixed recipe times and flag unverifiable ones ([#164](https://github.com/bojanrajkovic/mcp-paprika/issues/164)) ([9a91b3a](https://github.com/bojanrajkovic/mcp-paprika/commit/9a91b3a7ea414650ef18c0961c054ef8fc9ec66d)), closes [#162](https://github.com/bojanrajkovic/mcp-paprika/issues/162)
* **grocery:** accept null aisle_uid; drop no-aisle ingredients; default items to Miscellaneous ([#155](https://github.com/bojanrajkovic/mcp-paprika/issues/155)) ([e28f69f](https://github.com/bojanrajkovic/mcp-paprika/commit/e28f69f39eaa1cb936dc88d8efbeb6a2a2670722))
* **paprika:** remove phantom notes from pantry POST payload ([#131](https://github.com/bojanrajkovic/mcp-paprika/issues/131)) ([e1c49cc](https://github.com/bojanrajkovic/mcp-paprika/commit/e1c49cc8257bd73d1b115eb54051cb407d40a70e))
* **paprika:** remove server-computed photo_url and on_grocery_list from recipe POST ([#130](https://github.com/bojanrajkovic/mcp-paprika/issues/130)) ([c535813](https://github.com/bojanrajkovic/mcp-paprika/commit/c535813248fde4247b53b83d9456dced362d62d8)), closes [#127](https://github.com/bojanrajkovic/mcp-paprika/issues/127)
* **recipe:** emit created in Paprika wire format so create_recipe works ([#160](https://github.com/bojanrajkovic/mcp-paprika/issues/160)) ([9395f88](https://github.com/bojanrajkovic/mcp-paprika/commit/9395f88e921dea97b4ac8ba5705d15a46ccdc14d)), closes [#159](https://github.com/bojanrajkovic/mcp-paprika/issues/159)
* **transport:** correct HTTP graceful shutdown for Kubernetes ([#157](https://github.com/bojanrajkovic/mcp-paprika/issues/157)) ([57ec964](https://github.com/bojanrajkovic/mcp-paprika/commit/57ec964d96431f4ff92bfc2fa18238baee7bc624))


### Refactoring

* **meals:** consolidate shared meal helpers ([#141](https://github.com/bojanrajkovic/mcp-paprika/issues/141)) ([#144](https://github.com/bojanrajkovic/mcp-paprika/issues/144)) ([436b024](https://github.com/bojanrajkovic/mcp-paprika/commit/436b024692b2c8cd9fc7915a7fd051c10f18cfcd))
* **tools:** brand UID input schemas and extract shared lookup helper ([#145](https://github.com/bojanrajkovic/mcp-paprika/issues/145)) ([693055f](https://github.com/bojanrajkovic/mcp-paprika/commit/693055fed36470b61f54b8b02cf0cc65231d205b))
* **tools:** collapse uid?/name? lookup pairs into discriminated unions ([#139](https://github.com/bojanrajkovic/mcp-paprika/issues/139)) ([3ca1b65](https://github.com/bojanrajkovic/mcp-paprika/commit/3ca1b65c80bc13c3c5ec60a245278b6aa7c54df4))

## [1.4.0](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.3.0...v1.4.0) (2026-05-25)


### Features

* add grocery tools and resource surface ([#113](https://github.com/bojanrajkovic/mcp-paprika/issues/113)) ([e4d7226](https://github.com/bojanrajkovic/mcp-paprika/commit/e4d722690bce446dd8c55011d7235634fb453a89))
* **pantry:** replace add_pantry_item with batch add_pantry_items ([#123](https://github.com/bojanrajkovic/mcp-paprika/issues/123)) ([5a064dc](https://github.com/bojanrajkovic/mcp-paprika/commit/5a064dc6655a762169bfd0f514c6441c9bf96a65))
* **resources:** enrich recipe resource metadata header ([94fd73e](https://github.com/bojanrajkovic/mcp-paprika/commit/94fd73edee1edb61c4505f1a1e5acf92e820208e))
* **tools:** add aisle sync, list_aisles tool, and aisle resolution for pantry writes ([#107](https://github.com/bojanrajkovic/mcp-paprika/issues/107)) ([599c385](https://github.com/bojanrajkovic/mcp-paprika/commit/599c38559aaec9af5487b3d8b8b929cb617f5ce2))
* **tools:** add purchaseDate input and enrich list_pantry output ([d26ff16](https://github.com/bojanrajkovic/mcp-paprika/commit/d26ff1606059bcfbe5cbbb2aa2fbf2e9953bc8ec))
* **tools:** add UIDs and hierarchy to list_categories output ([4233042](https://github.com/bojanrajkovic/mcp-paprika/commit/4233042d3f2521ca23ea8ebd5e78cec75daa806b))


### Bug Fixes

* **deps:** update dependency hono to v4.12.22 ([#112](https://github.com/bojanrajkovic/mcp-paprika/issues/112)) ([81d82de](https://github.com/bojanrajkovic/mcp-paprika/commit/81d82de8c824f7675682bc69a8b434418a5ffa06))
* **deps:** update dependency hono to v4.12.23 ([#114](https://github.com/bojanrajkovic/mcp-paprika/issues/114)) ([65c38a0](https://github.com/bojanrajkovic/mcp-paprika/commit/65c38a0dc4ba52e143b4b15ff54165d3ac46323c))
* **types:** remove dead locationUid field from PantryItem ([b98661c](https://github.com/bojanrajkovic/mcp-paprika/commit/b98661c50b21aefd0b1243c7b1a037a2fdbb3f33)), closes [#56](https://github.com/bojanrajkovic/mcp-paprika/issues/56)


### Refactoring

* **entity:** extract TombstoneEntityStore base class ([#119](https://github.com/bojanrajkovic/mcp-paprika/issues/119)) ([e30a497](https://github.com/bojanrajkovic/mcp-paprika/commit/e30a497b667411501ffb34f3c71428aa6b0479b0))
* **paprika:** extract postEntities helper in PaprikaClient ([#120](https://github.com/bojanrajkovic/mcp-paprika/issues/120)) ([4df021f](https://github.com/bojanrajkovic/mcp-paprika/commit/4df021fd9af56ecf3bd99ec110a025d7e9f44e7f))
* retire paprika://pantry/{uid} resource surface ([#106](https://github.com/bojanrajkovic/mcp-paprika/issues/106)) ([69d00ee](https://github.com/bojanrajkovic/mcp-paprika/commit/69d00ee4f8675d55d401e3adba613b4b2741a665))
* **sync:** extract syncReplaceAllEntity + batch commit helpers ([#121](https://github.com/bojanrajkovic/mcp-paprika/issues/121)) ([6d6fe6c](https://github.com/bojanrajkovic/mcp-paprika/commit/6d6fe6c57603a012cad293f9d487233e9b41b726))
* **test:** migrate remaining as unknown as casts to fromAny ([#122](https://github.com/bojanrajkovic/mcp-paprika/issues/122)) ([dd5d9bd](https://github.com/bojanrajkovic/mcp-paprika/commit/dd5d9bd7d97acffc2d078b7cca7f876c568f5477))
* **tools:** normalize recipe summary fields across list-like tools ([78ccd56](https://github.com/bojanrajkovic/mcp-paprika/commit/78ccd56cfa7ef646162ed70a34fabf02f5ee4988))

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
