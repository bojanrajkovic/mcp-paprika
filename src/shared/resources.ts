import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { context, trace } from "@opentelemetry/api";

import { mcpServerOperationDuration } from "../telemetry/instruments.js";
import { getTracer } from "../telemetry/scope.js";
import { ATTR_MCP_METHOD_NAME } from "../telemetry/semconv.js";
import { errorTypeName, startOperation } from "../telemetry/trace-result.js";

const RESOURCES_READ_METHOD = "resources/read";

/** Which resource family served the read — the registration name; custom-prefixed (no semconv equivalent). */
const ATTR_RESOURCE_KIND = "mcp_paprika.resource.kind";

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
    try {
      const result = await context.with(trace.setSpan(context.active(), op.span), () => handler(...args));
      op.end();
      return result;
    } catch (cause) {
      if (cause instanceof McpError) {
        // ErrorCode's reverse mapping names the protocol error class
        // (InvalidParams, …) — low-cardinality by construction. Status stays
        // UNSET: an answered protocol error, not a server failure.
        op.end({ errorType: ErrorCode[cause.code] ?? String(cause.code) });
      } else {
        op.end({ errorType: errorTypeName(cause), isError: true });
      }
      throw cause;
    }
  };
}

/**
 * Signal that a resource read found no entity for its URI. An MCP resource read
 * has no in-band error channel (unlike a tool's `isError` result), so the
 * protocol reports "not found" by throwing: the SDK's Protocol layer turns the
 * thrown {@link McpError} into a JSON-RPC error response. This is the one
 * sanctioned throw on the resource read path — recognized form #1 in ADR-0014 —
 * so a resource resolves its entity and crosses to the boundary through here,
 * rather than throwing a bare `Error` (which the SDK would relay as a generic
 * message with no protocol error code).
 *
 * Returns `never`, so a call narrows the not-found branch exactly as `throw` did.
 */
export function resourceNotFound(message: string): never {
  throw new McpError(ErrorCode.InvalidParams, message);
}
