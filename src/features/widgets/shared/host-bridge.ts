import type { App } from "@modelcontextprotocol/ext-apps";

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
