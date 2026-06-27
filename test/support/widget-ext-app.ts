import { vi } from "vitest";

/**
 * Drains the microtask queue by yielding to the macro-task queue.
 *
 * `connectHost` calls `Promise.resolve(app.connect()).then(apply)` — one microtask tick
 * (ES2020: `Promise.resolve` of a native Promise is identity). `setTimeout(0)` is a
 * macro-task and always runs after the microtask queue empties, so it reliably waits for
 * the `.then(apply)` to fire.
 */
export const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * A minimal duck-typed fake for the ext-apps `App` instance — only the surface that
 * `connectHost`, `callTool`, and `errorText` in `host-bridge.ts` actually call. Typed
 * structurally (not via the real `App` class) so the harness stays in the node-side test
 * support without importing browser code; callers cast via `as unknown as App` when passing
 * to the bridge helpers.
 */
export interface FakeApp {
  ontoolresult: ((result: unknown) => void) | undefined;
  onhostcontextchanged: (() => void) | undefined;
  connect: ReturnType<typeof vi.fn>;
  getHostContext: ReturnType<typeof vi.fn>;
  callServerTool: ReturnType<typeof vi.fn>;
  readServerResource: ReturnType<typeof vi.fn>;
}

export interface UseExtAppResult {
  readonly app: FakeApp;
  /** Drive the widget's `onResult` handler — simulates a host `ontoolresult` notification. */
  fireToolResult(result: unknown): void;
  /**
   * Drive the widget's `onContext`/`applyHostStyles` path — simulates a host-context-changed
   * notification. Pass `updatedCtx` to change what `getHostContext()` returns before firing.
   */
  fireHostContextChanged(updatedCtx?: unknown): void;
}

/**
 * Returns a controllable fake ext-apps `App` instance (the surface `host-bridge.ts` calls) with
 * helpers to fire bridge notifications. The ext-apps style helpers are now real value imports
 * (ADR-0025), so a test asserting them mocks `@modelcontextprotocol/ext-apps` directly (see
 * `host-style.test.ts`) rather than installing a `globalThis.ExtApps` fake here.
 *
 * Usage in a widget browser test:
 * ```typescript
 * const { app, fireToolResult, fireHostContextChanged } = useExtApp({ theme: "dark", userAgent: "claude" });
 * connectHost(app as unknown as App, { onResult, onContext });
 * await flushMicrotasks();   // let connect().then(apply) resolve
 * fireToolResult({ structuredContent: { ... } });
 * expect(onResult).toHaveBeenCalledWith(...);
 * ```
 */
export function useExtApp(initialCtx: unknown = { theme: "light" }): UseExtAppResult {
  let currentCtx = initialCtx;

  const app: FakeApp = {
    ontoolresult: undefined,
    onhostcontextchanged: undefined,
    connect: vi.fn(() => Promise.resolve()),
    getHostContext: vi.fn(() => currentCtx),
    callServerTool: vi.fn(() => Promise.resolve({ content: [] })),
    readServerResource: vi.fn(() => Promise.resolve({ contents: [] })),
  };

  return {
    app,
    fireToolResult(result: unknown) {
      app.ontoolresult?.(result);
    },
    fireHostContextChanged(updatedCtx?: unknown) {
      if (updatedCtx !== undefined) currentCtx = updatedCtx;
      app.onhostcontextchanged?.();
    },
  };
}
