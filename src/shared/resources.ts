import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

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
