# Changelog

## [1.6.1](https://github.com/bojanrajkovic/mcp-paprika/compare/v1.6.0...v1.6.1) (2026-06-07)


### Bug Fixes

* **meal:** tolerate null/missing fields in meal wire rows so one bad row cannot wedge the meal store ([#290](https://github.com/bojanrajkovic/mcp-paprika/issues/290))

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
