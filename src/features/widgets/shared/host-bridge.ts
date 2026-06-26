import type { App } from "@modelcontextprotocol/ext-apps";

import { applyHostStyles } from "./host-style.js";
import { perfMark, perfMeasure } from "./perf.js";
import { TRACEPARENT_KEY } from "./server-caps-key.js";

/** The `perf.ts` prefix on the render measures — the ones this widget owns and reports. */
const WIDGET_MEASURE_PREFIX = "paprika-widget:";

/**
 * After the first result, report this widget's render-timing measures to the server's
 * `record_widget_timing` sink, carrying the W3C traceparent the `resources/read` smuggled into the
 * HTML (`window[__MCP_TRACEPARENT__]`). The server re-parents the measures as child spans of that read,
 * so the client-side render timeline lands in our Tempo — no `@opentelemetry/*` in the bundle.
 *
 * Fire-and-forget: a `setTimeout(0)` macrotask so it never blocks the result handler or the paint that
 * follows, a swallowed rejection, and a clean no-op when no traceparent was injected (telemetry off) or
 * there are no widget measures yet. `performance.timeOrigin` + `Date.now()` let the server correct the
 * client↔server clock skew.
 */
export function reportWidgetTiming(app: App): void {
  const traceparent = (globalThis as Record<string, unknown>)[TRACEPARENT_KEY];
  if (typeof traceparent !== "string") return;
  setTimeout(() => {
    const measures = performance
      .getEntriesByType("measure")
      .filter((m) => m.name.startsWith(WIDGET_MEASURE_PREFIX))
      .map((m) => ({ name: m.name, startTime: m.startTime, duration: m.duration }));
    if (measures.length === 0) return;
    void app
      .callServerTool({
        name: "record_widget_timing",
        arguments: { traceparent, timeOrigin: performance.timeOrigin, clientReportTime: Date.now(), measures },
      })
      .catch(() => undefined);
  }, 0);
}

/**
 * The two result shapes a widget's `receive()` accepts: a real ext-apps tool result (from
 * `ontoolresult`) and {@link callTool}'s narrowed wrapper. Both expose the structured channel; only
 * the former carries `content` (the error-text fallback). Untrusted host payload — every field is
 * checked at the call site (the SDK does not validate notification params).
 */
export interface ReceivedResult {
  readonly structuredContent?: Record<string, unknown> | undefined;
  readonly content?: readonly { readonly type: string; readonly text?: string }[] | undefined;
}

/**
 * Call a server tool through the host bridge, treating a transport rejection the same as a
 * tool-reported error so an in-flight row is never left stuck. Returns the structured channel too,
 * for callers that reconcile from it (the grocery re-add); subtractive callers ignore it.
 */
export async function callTool(
  app: App,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; structuredContent: Record<string, unknown> | undefined }> {
  try {
    const res = await app.callServerTool({ name, arguments: args });
    return { isError: Boolean(res.isError), structuredContent: res.structuredContent };
  } catch {
    return { isError: true, structuredContent: undefined };
  }
}

/**
 * The error-state text fallback: a non-structured result (unknown UID / no match / disambiguation)
 * carries its remediation in a text block. Returned verbatim for display only — never parsed for
 * data. `null` when there is no usable text.
 */
export function errorText(result: ReceivedResult | null | undefined): string | null {
  const block = result?.content?.find((c) => c.type === "text");
  const text = typeof block?.text === "string" ? block.text : undefined;
  return text && text.trim() !== "" ? text : null;
}

/** One content block from a `resources/read` — a text or blob resource content. Untrusted host payload. */
export type ResourceContent = NonNullable<Awaited<ReturnType<App["readServerResource"]>>["contents"]>[number];

/**
 * Read a server resource through the host bridge and return its first content block, or `null` when
 * the read rejects or the resource is empty. Content-type-agnostic: the caller decides what to do with
 * the block — a blob becomes a media `src` via {@link blobDataUri}, a text block is read directly. The
 * image policy lives at the call site, not here, so a future non-image consumer needs no branching.
 */
export async function readResource(app: App, uri: string): Promise<ResourceContent | null> {
  try {
    const result = await app.readServerResource({ uri });
    return result.contents?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a `data:` URI from a blob resource content for a media `src` (an `<img>`, `<audio>`, …), using
 * the content's own mimeType, or `fallbackMimeType` when the server didn't set one (a `data:` URI needs
 * a type). Returns `null` when the content is missing or carries no usable blob — so the caller falls
 * back to its placeholder rather than crash on a malformed host payload (the SDK doesn't validate it).
 */
export function blobDataUri(content: ResourceContent | null, fallbackMimeType: string): string | null {
  if (!content || !("blob" in content) || typeof content.blob !== "string" || content.blob === "") return null;
  const mimeType =
    typeof content.mimeType === "string" && content.mimeType !== "" ? content.mimeType : fallbackMimeType;
  return `data:${mimeType};base64,${content.blob}`;
}

/**
 * Wire a widget to its host in one call: register the tool-result handler, adopt the host's style
 * tokens + typeface ({@link applyHostStyles}) on connect AND on every host-context change, and hand the
 * widget the merged context for its own reads (theme, touch). Handlers are set BEFORE `connect()`, so
 * the handshake's first notifications are not missed. `onContext` always receives the FULL merged
 * context (`app.getHostContext()`) — correct on a change event too, since the SDK merges the partial
 * change params into the stored context before the handler fires (the change payload alone may omit
 * `userAgent`, which would reset the font). This is the one bit of per-widget boilerplate the shared
 * extraction would otherwise leave duplicated.
 */
export function connectHost(
  app: App,
  handlers: {
    onResult: (result: ReceivedResult) => void;
    onContext?: (ctx: ReturnType<App["getHostContext"]>) => void;
  },
): void {
  const apply = (): void => {
    const ctx = app.getHostContext();
    handlers.onContext?.(ctx);
    applyHostStyles(ctx);
  };
  // `connected` closes the handshake interval, `first-result` the data-delivery interval
  // (the gap the widget spends on its own loading screen waiting for the host's tool-result push).
  let firstResult = true;
  app.ontoolresult = (result) => {
    if (firstResult) {
      firstResult = false;
      perfMark("first-result");
      perfMeasure("connected-to-first-result", "connected", "first-result");
      // The render marks are all in by now (mount + handshake + first data); report them once,
      // deferred, so the whole boot timeline reaches our Tempo via record_widget_timing.
      reportWidgetTiming(app);
    }
    handlers.onResult(result);
  };
  app.onhostcontextchanged = apply;
  Promise.resolve(app.connect()).then(() => {
    perfMark("connected");
    perfMeasure("boot-to-connected", "boot", "connected");
    apply();
  });
}
