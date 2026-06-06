# Test support

Last verified: 2026-06-05

Fixtures, generated wire-captures, and test helpers — the test-only code that supports the colocated `src/**/*.test.ts` suite. The decision and its rejected alternatives live in `../docs/adr/0006-test-fixtures-out-of-src.md`; this file is the layout pointer plus sharp edges.

## Layout

- `support/` — cross-cutting helpers used across many tests: `kernel-harness` (`useKernelHarness` — the composable harness most tool/resource tests run through: it builds a module plus its dependency closure against a test `Infra`, registers the root module's tools/resources on a stub server, and seeds the built modules' private stores), `tool-test-utils` (`makeTestServer` / `getText` / `makeStubNotifier` / `makePinoCapture`), `msw` / `paprika-msw` (MSW server + Paprika handlers), `xdg-isolation`.
- `fixtures/` — shared data: the `SeedData` type (the declarative payload `useKernelHarness().seed()` consumes), and `wire-captures/` (generated HAR replay modules + their drift tests).
- `domains/<domain>/__fixtures__/` — per-entity data factories (`make<Entity>`), mirroring `src/domains/<domain>/` (e.g. `domains/recipe/__fixtures__/recipes.ts`, `domains/meal-type/__fixtures__/meal-types.ts`). Non-domain support areas keep their own `<area>/__fixtures__/` and `<area>/test-utils.ts` (e.g. `auth/`, `paprika/`).

## Test tiers

The suite is four vitest projects keyed on the file suffix — `pnpm test` runs all of them and is the gate; `pnpm test:<tier>` runs one. The decision and its rejected alternatives live in [`../docs/adr/0013-test-pyramid-and-tiers.md`](../docs/adr/0013-test-pyramid-and-tiers.md); the map:

- **unit** (`*.test.ts`) — a unit in isolation, the harness-driven **module-integration** tool/resource tests (`useKernelHarness`; no sync, no transport), and `*.property.test.ts`.
- **integration** (`*.test.integration.ts`) — the real `buildKernel` + boot sync, cold-start disk persistence.
- **e2e** (`*.e2e.test.ts`) — the real MCP transport/process boundary (stdio, HTTP + OAuth).
- **external** (`*.external.test.ts`) — needs a live external service (Ollama); self-skips when absent.

## Rules

- **Tests do not live here.** Colocated `*.test.ts` stays in `src/` next to the code it exercises; only support code moves here. The exceptions are tests _of_ the support itself (e.g. `fixtures/wire-captures/*.test.ts`), which sit with what they test, and `conformance/` — the tree-wide gates that exercise all of `src/` rather than any one unit (the ADR-0014 throw gate, the ADR-0016 UID-leaf gate).
- **Plain relative imports, no aliases.** Reaching production code reads `../../../src/domains/<domain>/...` — deliberately honest about the test→source dependency. See ADR-0006.
- This tree is outside the build (`tsconfig.json` `include: ["src"]`), so nothing here ships to `dist/`. It is type-checked via `tsconfig.test.json` and linted via `pnpm lint` (which now covers `src/ test/`).

## Sharp edges

**`fixtures/wire-captures/*.ts` (except the `.test.ts` files) are generated — do not hand-edit.** They are produced by `pnpm generate:fixtures` from the HAR files in `docs/wire-captures/`; the generator's `OUT_DIR` points here. Edit the HAR (or the generator) and regenerate. See `docs/wire-captures/README.md`.
