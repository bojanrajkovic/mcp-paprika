# ADR-0006: Move test fixtures and helpers out of `src/`, keep colocated tests

**Status:** Accepted (2026-06-02)

## Context

`src/` mixed production code with three flavors of test-support code scattered through the entity directories: `__fixtures__/` data modules, an `__tests__/` helper, and `*test-utils*` files. Test support outweighed production code roughly 2.5-to-1 by line count, so opening any entity directory meant wading past fixtures and helpers to find the module itself, and the production/test boundary was implicit. The build had to carry a five-pattern `exclude` list to keep all of that out of `dist/`, and the heaviest single chunk — the generated `wire-captures/` HAR fixtures — sat in the hand-written source tree even though it is machine-generated data.

## Decision

Test support moves to a top-level `test/` tree that mirrors `src/`'s entity structure: `test/support/` for cross-cutting helpers, `test/fixtures/` for shared data and the generated `wire-captures/` tree, and `test/<entity>/__fixtures__/` for per-entity data. The HAR generator writes to `test/fixtures/wire-captures/`.

Colocated `src/**/*.test.ts` tests **stay in `src/`**, next to the code they exercise. The driving value is locality: a module and its test live and move together as one unit, an untested file is a visible gap in its own directory, and structural refactors (the per-entity module is the unit of change here) carry the test along. Only the _support_ code — which is shared across many tests and has no single owning module — earns a separate home.

Imports stay **plain relative**; no path aliases. A fixture importing production code reads `../../../src/<entity>/types.js`, which is honest about a test artifact reaching up into the source tree.

## Rejected alternatives

### Full split — move tests out of `src/` too

Rejected because it would break colocation: tests would no longer sit beside the code they exercise, refactors would have to edit two mirrored trees and could drift out of sync, and a missing test would no longer be visible in its module's directory. The complaint was fixture load, not test placement.

### Status quo — leave everything in `src/`

Rejected because the production/test boundary stayed implicit, the build's `exclude` list stayed fragile, and generated wire-capture data kept living in the hand-written source tree.

### Path aliases (`#test/*` subpath imports) for the moved code

Rejected because the repo resolves every relative import with explicit `.js` paths and no aliases; introducing a second resolution mechanism would buy only shorter specifiers and decoupling from fixture location — a speculative future-proofing the repo's "smallest change that fits existing patterns" rule defers until the churn actually recurs.

## Consequences

**Positive**

- `src/` reads as production code plus its colocated tests; fixtures and helpers are out of the way.
- The build `exclude` list drops to three patterns. `test/` is outside the build's `include: ["src"]`, so nothing test-related can reach `dist/` structurally.
- Generated wire-capture data no longer sits in the hand-written source tree.

**Negative**

- Per-entity fixtures and the wire-capture tests reach production code through deeper relative paths (`../../../src/...`).
- `tsconfig.test.json` needs `rootDir: "."` so it can type-check `src/` and `test/` together; `vitest` and the lint scope each gain a `test/` glob.
- A fixture move is a cross-tree edit (importers in `src/`, the file in `test/`); without aliases, relocating a fixture rewrites its importers' relative paths.

## References

- Issue: #213
- Related: ADR-0005 (per-entity composition modules — the entity directory as the unit this layout mirrors)
- Layout guide: `test/CLAUDE.md`
