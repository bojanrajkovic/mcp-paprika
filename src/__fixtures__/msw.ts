/**
 * F1: MSW server lifecycle composable for tests.
 *
 * Wires the standard `beforeAll(listen) + afterEach(resetHandlers) + afterAll(close)`
 * lifecycle triple — which appears across every OAuth integration test file —
 * into a single `useMswServer()` call.
 *
 * Optionally accepts an `onReset` callback that runs alongside `resetHandlers`
 * in `afterEach`, which is used to call `oidcStub.resetOverrides()` in files
 * that own a persistent OidcStub instance.
 *
 * @example  Basic (no stub reset)
 *   const server = useMswServer();
 *   server.use(...handlers);  // same API as the underlying MSW server
 *
 * @example  With OidcStub reset
 *   const oidcStub = makeDefaultOidcStub();
 *   const server = useMswServer({ onReset: () => oidcStub.resetOverrides() });
 *   server.use(...oidcStub.handlers);
 *
 * @example  Unhandled-request bypass (e.g. HTTP e2e tests that only intercept some routes)
 *   const server = useMswServer({ onUnhandledRequest: "bypass" });
 */

import { beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import type { HttpHandler } from "msw";

export type UseMswServerOptions = {
  /**
   * MSW `onUnhandledRequest` policy. Defaults to "error" (MSW default) so
   * unexpected requests surface immediately as test failures. Set to "bypass"
   * when the test intentionally lets some requests through to real network
   * (or when another layer handles unmatched routes). A callback may be passed
   * for host-scoped policies (e.g. `failLoudOnUpstream` — error on real upstream
   * hosts, bypass the in-process localhost server the test drives).
   */
  readonly onUnhandledRequest?:
    | "error"
    | "warn"
    | "bypass"
    | ((request: Request, print: { warning: () => void; error: () => void }) => void);
  /**
   * Optional callback run in `afterEach` alongside `server.resetHandlers()`.
   * Useful for calling `oidcStub.resetOverrides()` in tests that share a
   * persistent OidcStub across all tests in a describe block.
   */
  readonly onReset?: () => void;
};

/**
 * Creates an MSW `setupServer()` instance and wires it into vitest's lifecycle:
 * - `beforeAll` — starts the server (with optional `onUnhandledRequest` policy)
 * - `afterEach`  — resets handlers (and calls `onReset` if provided)
 * - `afterAll`   — stops the server
 *
 * Returns the MSW server instance so callers can call `.use(...)` to add
 * per-test handlers.
 */
export function useMswServer(
  initialHandlers: ReadonlyArray<HttpHandler> = [],
  options: UseMswServerOptions = {},
): ReturnType<typeof setupServer> {
  const { onUnhandledRequest, onReset } = options;
  const server = setupServer(...initialHandlers);

  beforeAll(() => {
    server.listen(onUnhandledRequest !== undefined ? { onUnhandledRequest } : undefined);
  });

  afterEach(() => {
    server.resetHandlers();
    onReset?.();
  });

  afterAll(() => {
    server.close();
  });

  return server;
}
