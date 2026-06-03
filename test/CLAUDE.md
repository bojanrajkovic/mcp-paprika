# Test support

Last verified: 2026-06-02

Fixtures, generated wire-captures, and test helpers — the test-only code that supports the colocated `src/**/*.test.ts` suite. The decision and its rejected alternatives live in `../docs/adr/0006-test-fixtures-out-of-src.md`; this file is the layout pointer plus sharp edges.

## Layout

- `support/` — cross-cutting helpers used across many tests: `app-context` (the `AppContext` factory tests default through), `tool-test-utils` (`makeCtx` / `makeTestServer` / `seed` / `makePinoCapture`), `msw` / `paprika-msw` (MSW server + Paprika handlers), `xdg-isolation`.
- `fixtures/` — shared data: `seed`, and `wire-captures/` (generated HAR replay modules + their drift tests).
- `<entity>/__fixtures__/` — per-entity data factories (`make<Entity>`), mirroring `src/<entity>/`. `<entity>/test-utils.ts` for entity-scoped helpers (e.g. `auth/`).

## Rules

- **Tests do not live here.** Colocated `*.test.ts` stays in `src/` next to the code it exercises; only support code moves here. The exceptions are tests _of_ the support itself (`fixtures/seed.test.ts`, `fixtures/wire-captures/*.test.ts`), which sit with what they test.
- **Plain relative imports, no aliases.** Reaching production code reads `../../../src/<entity>/...` — deliberately honest about the test→source dependency. See ADR-0006.
- This tree is outside the build (`tsconfig.json` `include: ["src"]`), so nothing here ships to `dist/`. It is type-checked via `tsconfig.test.json` and linted via `pnpm lint` (which now covers `src/ test/`).

## Sharp edges

**`fixtures/wire-captures/*.ts` (except the `.test.ts` files) are generated — do not hand-edit.** They are produced by `pnpm generate:fixtures` from the HAR files in `docs/wire-captures/`; the generator's `OUT_DIR` points here. Edit the HAR (or the generator) and regenerate. See `docs/wire-captures/README.md`.
