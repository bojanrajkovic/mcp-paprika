# P2-U01 ServerContext Test Requirements

**Unit:** P2-U01 ServerContext Interface & Package Dependencies
**Generated:** 2026-03-13

## Overview

P2-U01 is pure infrastructure: it installs a runtime dependency (`mitt`) and defines a TypeScript `interface` with no runtime behavior. The design explicitly states "no tests required beyond `pnpm typecheck`." The TypeScript compiler is the primary verification mechanism for type-level correctness. Writing unit tests for type declarations would test the TypeScript compiler, not project code.

This document maps every acceptance criterion to a verification method and justifies why automated tests (unit/integration/e2e) are or are not appropriate.

---

## Verification Methods Used

| Method                      | Description                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript compiler**     | `pnpm typecheck` (tsc --noEmit). Verifies type correctness, import resolution, and module compatibility. This is the authoritative check for a unit with no runtime behavior. |
| **Shell command**           | A deterministic command whose exit code or output confirms the criterion. Can be run in CI or locally.                                                                        |
| **File content inspection** | Verifiable by reading file contents against a known-correct specification. Can be automated via a shell script or CI step, but does not warrant a vitest test file.           |
| **Automated test**          | A vitest test that exercises runtime behavior. Only appropriate when there is behavior to test.                                                                               |

---

## AC1: mitt installed as runtime dependency

### AC1.1: `package.json` `dependencies` contains `mitt`

- **Verification method:** Shell command
- **Command:** `node -e "const pkg = require('./package.json'); if (!pkg.dependencies?.mitt) process.exit(1)"`
- **Justification:** This is a package manifest check, not a code behavior. The `pnpm add mitt` command is idempotent and its result is verified by inspecting `package.json`. A vitest test would be testing pnpm's behavior, not project code.
- **CI coverage:** The existing CI workflow runs `pnpm install` (which fails if the lockfile is inconsistent with `package.json`), providing indirect verification that the dependency is correctly declared.

### AC1.2: `pnpm-lock.yaml` updated with mitt resolution (lockfile not stale)

- **Verification method:** Shell command
- **Command:** `pnpm install --frozen-lockfile` (exits non-zero if lockfile is stale)
- **Justification:** Lockfile staleness is a package manager concern. CI already runs `pnpm install --frozen-lockfile`, which verifies this criterion on every PR.
- **CI coverage:** Covered by the existing CI workflow's install step.

---

## AC2: ServerContext interface is correct

### AC2.1: `src/types/server-context.ts` exports an `interface ServerContext` (not `type`)

- **Verification method:** File content inspection
- **Check:** The file contains `export interface ServerContext {` (not `export type ServerContext =`)
- **Justification:** Whether a declaration uses `interface` vs `type` is a syntactic choice with no runtime effect. The TypeScript compiler accepts both. This criterion ensures extensibility for Phase 3 (`extends` keyword), which is a design constraint verified by code review, not by a test. A vitest test cannot distinguish between `interface` and `type` at runtime -- both are erased.
- **Automated alternative:** A shell command can verify this: `rg "^export interface ServerContext" src/types/server-context.ts`

### AC2.2: Interface has exactly 4 fields: `client: PaprikaClient`, `cache: DiskCache`, `store: RecipeStore`, `server: McpServer`

- **Verification method:** TypeScript compiler + file content inspection
- **Justification:** The TypeScript compiler verifies that the referenced types (`PaprikaClient`, `DiskCache`, `RecipeStore`, `McpServer`) resolve correctly and that the field types are valid. The "exactly 4 fields" constraint is a design requirement verified by reading the file. A vitest test could use `keyof` tricks to assert field names, but that would test TypeScript's type system, not project behavior. The file is specified verbatim in the implementation plan, making code review sufficient.
- **Automated alternative:** A shell command can count fields: `rg "readonly \w+:" src/types/server-context.ts --count`

### AC2.3: All 4 fields are `readonly`

- **Verification method:** TypeScript compiler + file content inspection
- **Justification:** If a field lacks `readonly`, the TypeScript compiler still accepts the file -- `readonly` is a constraint on consumers, not on the declaration itself. However, the implementation plan specifies the exact file content with all fields marked `readonly`. Code review and a simple shell check verify this. A vitest test asserting readonly-ness would require complex type-level gymnastics (e.g., conditional types checking assignability) that test TypeScript's type system rather than project logic.
- **Automated alternative:** `rg "^\s+readonly (client|cache|store|server):" src/types/server-context.ts --count` should return 4.

### AC2.4: All imports use `import type` -- no value imports

- **Verification method:** File content inspection
- **Justification:** `import type` vs `import` has no runtime effect in this context (all imported symbols are classes used only as types). The design requires `import type` to avoid unintended side-effect imports. This is a style constraint verified by reading the import lines. A vitest test cannot detect the difference at runtime.
- **Automated alternative:** `rg "^import " src/types/server-context.ts` should show only lines matching `^import type`.

### AC2.5: All import paths use `.js` extension

- **Verification method:** TypeScript compiler
- **Justification:** Under NodeNext module resolution, the TypeScript compiler rejects relative imports that lack `.js` extensions. If the extensions are missing, `pnpm typecheck` fails. The compiler is the authoritative verifier here.
- **CI coverage:** Covered by the existing CI workflow's typecheck step.

### AC2.6: `PaprikaConfig` is absent from the interface

- **Verification method:** File content inspection
- **Check:** The file does not contain the string `PaprikaConfig`
- **Justification:** This is a negative constraint ("X must not be present"). It is trivially verified by searching the file. A vitest test would be checking file contents, which is not testing behavior.
- **Automated alternative:** `rg "PaprikaConfig" src/types/server-context.ts` should return no matches (exit code 1).

---

## AC3: TypeScript compilation passes

### AC3.1: `pnpm typecheck` exits 0

- **Verification method:** Shell command
- **Command:** `pnpm typecheck`
- **Justification:** This is the primary correctness gate for the entire unit. It verifies that all imports resolve, all types are compatible, and the file integrates cleanly with the rest of the codebase. It is already part of the CI pipeline and the pre-push git hook.
- **CI coverage:** Covered by the existing CI workflow's typecheck step and the pre-push hook.

### AC3.2: No `@ts-ignore` or `@ts-expect-error` suppressions in new files

- **Verification method:** File content inspection
- **Check:** `src/types/server-context.ts` does not contain `@ts-ignore` or `@ts-expect-error`
- **Justification:** This is a negative constraint on file content, not runtime behavior.
- **Automated alternative:** `rg "@ts-ignore|@ts-expect-error" src/types/server-context.ts` should return no matches (exit code 1).

---

## AC4: CLAUDE.md updated

### AC4.1: `src/types/CLAUDE.md` documents `ServerContext` with field table and correct import path example

- **Verification method:** Human verification (code review)
- **Justification:** This criterion requires verifying that documentation is accurate, complete, and matches the implementation. Specifically:
  - The file contains a field table listing all 4 fields with correct types and descriptions
  - The import path example uses `import type` and the correct `.js`-extended path
  - The module purpose section accurately describes ServerContext's role

  Documentation quality is inherently a human judgment. While a shell script could check for the presence of specific strings, it cannot verify that the documentation is accurate, well-structured, or helpful.

- **Verification approach:** During code review, confirm that:
  1. The field table lists `client`, `cache`, `store`, `server` with correct types
  2. The import example reads `import type { ServerContext } from "../types/server-context.js";`
  3. The description mentions readonly, interface (not type), and dependency injection
  4. The "Used by" section references Phase 2 modules

---

## Summary Matrix

| Criterion                    | Automated Test | Verification Method                            | CI Coverage             |
| ---------------------------- | -------------- | ---------------------------------------------- | ----------------------- |
| AC1.1 mitt in dependencies   | No             | Shell command (package.json check)             | Indirect (pnpm install) |
| AC1.2 lockfile not stale     | No             | Shell command (pnpm install --frozen-lockfile) | Yes                     |
| AC2.1 `interface` not `type` | No             | File content inspection / shell grep           | No (add if desired)     |
| AC2.2 exactly 4 fields       | No             | TypeScript compiler + file inspection          | Yes (typecheck)         |
| AC2.3 all fields `readonly`  | No             | File content inspection / shell grep           | No (add if desired)     |
| AC2.4 `import type` only     | No             | File content inspection / shell grep           | No (add if desired)     |
| AC2.5 `.js` extensions       | No             | TypeScript compiler (NodeNext)                 | Yes (typecheck)         |
| AC2.6 no PaprikaConfig       | No             | File content inspection / shell grep           | No (add if desired)     |
| AC3.1 typecheck passes       | No             | Shell command (pnpm typecheck)                 | Yes                     |
| AC3.2 no suppressions        | No             | File content inspection / shell grep           | No (add if desired)     |
| AC4.1 CLAUDE.md updated      | No             | Human verification (code review)               | No                      |

## Rationale: No Automated Tests

Zero vitest test files are required for this unit. This is consistent with:

1. **The design plan** which explicitly states: "no tests required beyond `pnpm typecheck`"
2. **The implementation plan** which confirms: "The test suite should pass unchanged (no new tests were added -- this unit is pure infrastructure verified by the TypeScript compiler)"
3. **The nature of the deliverables**: an `interface` declaration has no runtime behavior to test; `mitt` installation is a package manager operation

Writing unit tests for type declarations would test the TypeScript compiler's correctness, not project code. The verification strategy relies on:

- `pnpm typecheck` for type-level correctness (AC2.2, AC2.5, AC3.1)
- `pnpm install --frozen-lockfile` for dependency correctness (AC1.1, AC1.2)
- File content inspection for style/design constraints (AC2.1, AC2.3, AC2.4, AC2.6, AC3.2)
- Code review for documentation quality (AC4.1)
