import type { App } from "@modelcontextprotocol/ext-apps";

import { applyHostStyles } from "./host-style.js";

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
  app.ontoolresult = (result) => handlers.onResult(result);
  app.onhostcontextchanged = apply;
  Promise.resolve(app.connect()).then(apply);
}
