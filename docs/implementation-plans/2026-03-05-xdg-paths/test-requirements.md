# Test Requirements: XDG Paths (Phase 1)

This document maps every acceptance criterion from the XDG Paths design plan to either an automated test or a documented human verification step. Its purpose is to ensure full traceability between requirements and verification before implementation begins.

## Automated Test Coverage

All automated tests reside in `src/utils/xdg.test.ts` and run via `pnpm test`.

| AC Identifier   | Acceptance Criterion Text                                                                            | Test Type   | Test File               | Automated | Notes                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------- | ----------- | ----------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| xdg-paths.AC1.1 | `getConfigDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent) | Unit        | `src/utils/xdg.test.ts` | Yes       | Assert `path.isAbsolute(result)` is true and `path.basename(result)` equals `mcp-paprika`                                                                                     |
| xdg-paths.AC1.2 | `getCacheDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)  | Unit        | `src/utils/xdg.test.ts` | Yes       | Assert `path.isAbsolute(result)` is true and `path.basename(result)` equals `mcp-paprika`                                                                                     |
| xdg-paths.AC1.3 | `getDataDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)   | Unit        | `src/utils/xdg.test.ts` | Yes       | Assert `path.isAbsolute(result)` is true and `path.basename(result)` equals `mcp-paprika`                                                                                     |
| xdg-paths.AC1.4 | `getLogDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)    | Unit        | `src/utils/xdg.test.ts` | Yes       | Assert `path.isAbsolute(result)` is true and `path.basename(result)` equals `mcp-paprika`                                                                                     |
| xdg-paths.AC1.5 | `getTempDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)   | Unit        | `src/utils/xdg.test.ts` | Yes       | Assert `path.isAbsolute(result)` is true and `path.basename(result)` equals `mcp-paprika`                                                                                     |
| xdg-paths.AC2.1 | All 5 functions are synchronous and perform no filesystem I/O                                        | Unit        | `src/utils/xdg.test.ts` | Yes       | Verify each return value is a `string` (not a `Promise`). Synchronous call semantics confirm no async/I/O.                                                                    |
| xdg-paths.AC2.2 | `env-paths` is listed as a runtime dependency in `package.json`                                      | Unit        | `src/utils/xdg.test.ts` | Yes       | Read `package.json`, parse JSON, assert `dependencies["env-paths"]` exists and is defined.                                                                                    |
| xdg-paths.AC2.3 | `pnpm build` and `pnpm typecheck` pass with zero errors                                              | Integration | N/A (CI pipeline)       | Yes       | Verified by running `pnpm build && pnpm typecheck` in CI or locally. Not a vitest test case -- verified via the pre-push hook (`pnpm typecheck && pnpm test`) and build step. |
| xdg-paths.AC3.1 | `src/utils/xdg.ts` imports only from `env-paths` (no imports from other `src/` modules)              | Unit        | `src/utils/xdg.test.ts` | Yes       | Read `src/utils/xdg.ts` source with `readFileSync`, assert no matches for `from\s+["']\./` or `from\s+["']\.\./` regex patterns.                                              |

## Criteria Requiring Human Verification

| AC Identifier   | Acceptance Criterion Text                               | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| xdg-paths.AC2.3 | `pnpm build` and `pnpm typecheck` pass with zero errors | This criterion verifies toolchain output rather than runtime behavior. It cannot be meaningfully expressed as a vitest unit test because the test runner itself depends on a successful build. Verification is performed by running `pnpm build && pnpm typecheck` after implementation and confirming zero exit codes. In practice, the pre-push git hook (`pnpm typecheck && pnpm test`) automates this check on every push, so human verification is only needed during initial implementation. |

## Test Organization

Tests in `src/utils/xdg.test.ts` follow the project's established pattern (see `src/paprika/errors.test.ts`):

```
describe("XDG path utilities")
  describe("xdg-paths.AC1: Module exports 5 path functions")
    it("xdg-paths.AC1.1: getConfigDir() returns absolute path ending with mcp-paprika")
    it("xdg-paths.AC1.2: getCacheDir() returns absolute path ending with mcp-paprika")
    it("xdg-paths.AC1.3: getDataDir() returns absolute path ending with mcp-paprika")
    it("xdg-paths.AC1.4: getLogDir() returns absolute path ending with mcp-paprika")
    it("xdg-paths.AC1.5: getTempDir() returns absolute path ending with mcp-paprika")
  describe("xdg-paths.AC2: Module characteristics")
    it("xdg-paths.AC2.1: all functions return strings synchronously")
    it("xdg-paths.AC2.2: env-paths is a runtime dependency in package.json")
  describe("xdg-paths.AC3: Leaf dependency contract")
    it("xdg-paths.AC3.1: xdg.ts has no relative imports from src/")
```

## Coverage Target

Per project conventions, `src/utils/xdg.ts` must achieve at least 70% coverage across statements, branches, functions, and lines. Given the module has 5 functions with no branching logic, the tests above should achieve 100% coverage.
