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

/**
 * The four top-level `globalThis.ExtApps` helpers that `host-style.ts` calls via the
 * inlined ext-apps runtime. `useExtApp` installs spies for all four so tests can assert
 * which helpers were (or were not) invoked.
 */
export interface FakeExtAppsRuntime {
  applyHostStyleVariables: ReturnType<typeof vi.fn>;
  applyHostFonts: ReturnType<typeof vi.fn>;
  applyDocumentTheme: ReturnType<typeof vi.fn>;
  getDocumentTheme: ReturnType<typeof vi.fn>;
}

export interface UseExtAppResult {
  readonly app: FakeApp;
  readonly extApps: FakeExtAppsRuntime;
  /** Drive the widget's `onResult` handler — simulates a host `ontoolresult` notification. */
  fireToolResult(result: unknown): void;
  /**
   * Drive the widget's `onContext`/`applyHostStyles` path — simulates a host-context-changed
   * notification. Pass `updatedCtx` to change what `getHostContext()` returns before firing.
   */
  fireHostContextChanged(updatedCtx?: unknown): void;
}

/**
 * Stands up a fake `globalThis.ExtApps` (style helper spies + an `App` class stub) and
 * returns a controllable fake `App` instance with helpers to fire bridge notifications.
 *
 * Usage in a widget browser test:
 * ```typescript
 * const { app, extApps, fireToolResult, fireHostContextChanged } = useExtApp({ theme: "dark", userAgent: "claude" });
 * connectHost(app as unknown as App, { onResult, onContext });
 * await flushMicrotasks();   // let connect().then(apply) resolve
 * fireToolResult({ structuredContent: { ... } });
 * expect(onResult).toHaveBeenCalledWith(...);
 * ```
 *
 * Teardown: call `vi.unstubAllGlobals()` in `afterEach` to restore `globalThis.ExtApps`.
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

  const extApps: FakeExtAppsRuntime = {
    applyHostStyleVariables: vi.fn(),
    applyHostFonts: vi.fn(),
    applyDocumentTheme: vi.fn(),
    getDocumentTheme: vi.fn(() => "light"),
  };

  vi.stubGlobal("ExtApps", extApps);

  return {
    app,
    extApps,
    fireToolResult(result: unknown) {
      app.ontoolresult?.(result);
    },
    fireHostContextChanged(updatedCtx?: unknown) {
      if (updatedCtx !== undefined) currentCtx = updatedCtx;
      app.onhostcontextchanged?.();
    },
  };
}
