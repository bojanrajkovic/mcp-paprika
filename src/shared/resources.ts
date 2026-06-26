import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { context, trace } from "@opentelemetry/api";

import { mcpServerOperationDuration } from "../telemetry/instruments.js";
import { getTracer } from "../telemetry/scope.js";
import { ATTR_MCP_METHOD_NAME } from "../telemetry/semconv.js";
import { errorTypeName, startOperation } from "../telemetry/trace-result.js";

const RESOURCES_READ_METHOD = "resources/read";

/** Which resource family served the read — the registration name; custom-prefixed (no semconv equivalent). */
const ATTR_RESOURCE_KIND = "mcp_paprika.resource.kind";
/** The exact URI read — SPAN-ONLY (per-entity, high-cardinality); tells a ui://widget read from a paprika://…/photo one. */
const ATTR_RESOURCE_URI = "mcp_paprika.resource.uri";
/** Served payload size in bytes — the server-side transfer-size proxy (a ~500 KB widget HTML vs a small read). */
const ATTR_RESOURCE_BYTES = "mcp_paprika.resource.bytes";

/**
 * Wrap a resource read handler with the `resources/read` span and the
 * `mcp.server.operation.duration` recording — the resource-side sibling of the
 * tool wrapper in `kernel/tool.ts`. The span name carries no `{target}` suffix:
 * the MCP semconv wants a LOW-cardinality target there, and a resource URI
 * (per-entity UID) is exactly what must stay out; the registration-name `kind`
 * attribute carries the family instead.
 *
 * Throw-transparent by design: {@link resourceNotFound}'s `McpError` IS the
 * protocol's answered not-found — an expected client-error class, so it records
 * `error.type` from the protocol code name but leaves span status UNSET (the
 * HTTP-semconv 4xx precedent); any other escape is a bug and marks the span
 * ERROR. Both rethrow unchanged for the SDK's Protocol layer to render.
 */
export function tracedResourceRead<Args extends ReadonlyArray<unknown>, Out>(
  kind: string,
  handler: (...args: Args) => Promise<Out>,
): (...args: Args) => Promise<Out> {
  const attributes = { [ATTR_MCP_METHOD_NAME]: RESOURCES_READ_METHOD, [ATTR_RESOURCE_KIND]: kind };
  return async (...args: Args): Promise<Out> => {
    const op = startOperation(
      getTracer(),
      RESOURCES_READ_METHOD,
      { attributes },
      { histogram: mcpServerOperationDuration, attributes },
    );
    // URI + served size on the SPAN only — high-cardinality (per-entity), so they stay OFF the
    // duration histogram's labels (which keep method + kind). The URI separates widget HTML reads
    // from photo reads in Tempo; the byte count is the server-side transfer-size signal.
    const uri = resourceUri(args[0]);
    if (uri !== undefined) op.span.setAttribute(ATTR_RESOURCE_URI, uri);
    try {
      const result = await context.with(trace.setSpan(context.active(), op.span), () => handler(...args));
      op.span.setAttribute(ATTR_RESOURCE_BYTES, resourceBytes(result));
      op.end();
      return result;
    } catch (cause) {
      if (cause instanceof McpError) {
        // ErrorCode's reverse mapping names the protocol error class
        // (InvalidParams, …) — low-cardinality by construction. Status stays
        // UNSET: an answered protocol error, not a server failure.
        op.end({ errorType: ErrorCode[cause.code] ?? String(cause.code) });
      } else {
        op.end({ errorType: errorTypeName(cause), isError: true, exception: cause });
      }
      throw cause;
    }
  };
}

/** The URI a read targeted — its first handler arg (a URL; a string defensively). */
function resourceUri(arg: unknown): string | undefined {
  if (arg instanceof URL) return arg.href;
  return typeof arg === "string" ? arg : undefined;
}

/** Approximate served bytes: UTF-8 length of each text block plus decoded length of each base64 blob. */
function resourceBytes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const { contents } = result as { contents?: unknown };
  if (!Array.isArray(contents)) return 0;
  let total = 0;
  for (const item of contents) {
    if (typeof item !== "object" || item === null) continue;
    const { text, blob } = item as { text?: unknown; blob?: unknown };
    if (typeof text === "string") total += Buffer.byteLength(text, "utf8");
    if (typeof blob === "string") total += Math.floor((blob.length * 3) / 4);
  }
  return total;
}

/**
 * Signal that a resource read found no entity for its URI. An MCP resource read
 * has no in-band error channel (unlike a tool's `isError` result), so the
 * protocol reports "not found" by throwing: the SDK's Protocol layer turns the
 * thrown {@link McpError} into a JSON-RPC error response. This is the one
 * sanctioned throw on the resource read path —
 * so a resource resolves its entity and crosses to the boundary through here,
 * rather than throwing a bare `Error` (which the SDK would relay as a generic
 * message with no protocol error code).
 *
 * Returns `never`, so a call narrows the not-found branch exactly as `throw` did.
 */
export function resourceNotFound(message: string): never {
  throw new McpError(ErrorCode.InvalidParams, message);
}
