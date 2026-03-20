# Test Requirements: p2-u12-entry-point

Maps each acceptance criterion to either an automated test or a documented human verification approach.

---

## AC4: DiskCache Logging Refactor — Automated Tests

AC4 is the only group with automated test coverage. Tests live in the existing DiskCache test suite.

| Criterion                                                               | Test Type | Test File                                        | What the Test Verifies                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | --------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC4.1** DiskCache no longer accepts a `log` callback parameter        | Unit      | `src/cache/disk-cache.test.ts`                   | Constructor is called as `new DiskCache(tempDir)` without a second argument. The test compiles and passes under `pnpm typecheck`, which confirms the parameter no longer exists in the type signature.                                         |
| **AC4.2** DiskCache diagnostic messages are written to `process.stderr` | Unit      | `src/cache/disk-cache.test.ts` (AC1.4 test case) | Spies on `process.stderr.write` via `vi.spyOn(process.stderr, "write")`, triggers a corrupt index.json scenario, and asserts the spy was called with a string containing `"corrupt"`.                                                          |
| **AC4.3** Existing DiskCache tests pass after refactor                  | Unit      | `src/cache/disk-cache.test.ts`                   | All 41 existing DiskCache tests pass after the refactor. The AC1.4 test is updated to use `process.stderr.write` spy instead of the removed log callback; all other tests are unchanged since they never used the second constructor argument. |

---

## AC1: Startup Sequence — Human Verification

**Justification:** The entry point is pure wiring code with no exported functions or classes. It cannot be unit-tested without mocking every dependency (config, client, cache, store, server, transport), which would produce brittle tests that mirror the implementation. The design plan explicitly states integration/E2E tests are out of scope. These criteria are verified operationally: if the code compiles (`pnpm typecheck`) and builds (`pnpm build`), the wiring is structurally correct.

| Criterion                                                                                  | Verification Approach                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1.1** Server starts successfully with valid config and credentials                     | **Code review + typecheck.** Verify that `main()` calls `loadConfig()`, constructs `PaprikaClient`, calls `authenticate()`, constructs `DiskCache`, calls `init()`, and proceeds through the full startup sequence. `pnpm typecheck` confirms all calls are type-correct. |
| **AC1.2** All 8 tools are registered before `server.connect(transport)`                    | **Code review.** Verify that all 7 registration function calls (registering 8 tools total) appear in `src/index.ts` before the `server.connect(transport)` call. `pnpm typecheck` confirms the registration functions are called with correct argument types.             |
| **AC1.3** Recipe resources are registered before `server.connect(transport)`               | **Code review.** Verify that `registerRecipeResources(server, ctx)` appears before `server.connect(transport)` in the source.                                                                                                                                             |
| **AC1.4** `sync.start()` is called before `server.connect(transport)` when sync is enabled | **Code review.** Verify that the conditional `if (config.sync.enabled) { sync.start(); }` block appears before `server.connect(transport)`.                                                                                                                               |
| **AC1.5** Sync engine is created but NOT started when `config.sync.enabled` is false       | **Code review.** Verify that `SyncEngine` construction is unconditional and `sync.start()` is guarded by `if (config.sync.enabled)`.                                                                                                                                      |

---

## AC2: Error Handling — Human Verification

**Justification:** Error handling in the entry point relies on the `main().catch()` pattern, which calls `console.error` and `process.exit(1)`. Testing this would require spawning a child process with invalid environment variables and asserting on exit code and stderr output — this is E2E testing, which is explicitly out of scope. The individual modules that throw (config validation, authentication, cache init) have their own unit tests for failure cases.

| Criterion                                                                    | Verification Approach                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC2.1** Invalid config exits with non-zero code and stderr message         | **Code review + typecheck.** Verify that `loadConfig().match()` throws on the error branch, which propagates to `main().catch()`. Verify the catch handler calls `console.error(err)` and `process.exit(1)`. The `loadConfig()` function itself has unit tests covering invalid config scenarios. |
| **AC2.2** Authentication failure exits with non-zero code and stderr message | **Code review.** Verify that `client.authenticate()` is awaited inside `main()` with no try/catch — rejection propagates to `main().catch()`. The `PaprikaClient.authenticate()` method has its own tests for auth failure.                                                                       |
| **AC2.3** Cache init failure exits with non-zero code and stderr message     | **Code review.** Verify that `cache.init()` is awaited inside `main()` with no try/catch — rejection propagates to `main().catch()`. DiskCache `init()` has its own tests for I/O failure scenarios.                                                                                              |

---

## AC3: Shutdown — Human Verification

**Justification:** SIGINT handling involves `process.on("SIGINT", ...)` and `process.exit(0)`, which are side-effectful process-level operations. Testing would require spawning a child process, sending SIGINT, and observing behavior — this is E2E testing, explicitly out of scope.

| Criterion                                                        | Verification Approach                                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC3.1** SIGINT stops the sync engine and exits with code 0     | **Code review.** Verify that the SIGINT handler calls `sync.stop()` followed by `process.exit(0)`. The `SyncEngine.stop()` method has its own unit tests. |
| **AC3.2** SIGINT handler is registered before transport connects | **Code review.** Verify that `process.on("SIGINT", ...)` appears before `server.connect(transport)` in the source.                                        |

---

## AC5: Code Quality — Human Verification (Tooling-Assisted)

**Justification:** These criteria are verified by existing CI tooling (`pnpm typecheck`, `pnpm build`, `pnpm lint`) rather than dedicated test cases. They are structural properties of the source file, not behavioral properties.

| Criterion                                        | Verification Approach                                                                                                                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC5.1** `src/index.ts` exports nothing         | **Code review + typecheck.** Verify the file contains no `export` statements. The file should contain only `async function main()` (not exported) and the top-level `main().catch()` call. `pnpm lint` confirms no unexpected exports. |
| **AC5.2** `pnpm typecheck` passes with no errors | **CI gate.** Run `pnpm typecheck` after implementation. This is enforced by the pre-push hook and CI workflow.                                                                                                                         |
| **AC5.3** `pnpm build` succeeds                  | **CI gate.** Run `pnpm build` after implementation. This is enforced by the CI workflow.                                                                                                                                               |

---

## Summary

| Group                           | Criteria Count | Automated | Human Verification          |
| ------------------------------- | -------------- | --------- | --------------------------- |
| AC1: Startup Sequence           | 5              | 0         | 5 (code review + typecheck) |
| AC2: Error Handling             | 3              | 0         | 3 (code review + typecheck) |
| AC3: Shutdown                   | 2              | 0         | 2 (code review)             |
| AC4: DiskCache Logging Refactor | 3              | 3         | 0                           |
| AC5: Code Quality               | 3              | 0         | 3 (CI tooling)              |
| **Total**                       | **16**         | **3**     | **13**                      |

All 13 human-verification criteria are structurally verified by code review combined with `pnpm typecheck` and `pnpm build` passing. This is consistent with the design plan's decision that the entry point is pure wiring with no testable business logic, and that integration/E2E tests are out of scope.
