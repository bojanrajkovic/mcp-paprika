// Records `mcp.server.operation.duration` for the MCP messages the tool and
// resource chokepoints never see (`initialize`, `tools/list`, `ping`, …). The SDK
// has no interceptor seam, so this wraps the connected transport, the one place
// every JSON-RPC message crosses.

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type ClientNotification,
  type ClientRequest,
  ErrorCode,
  isJSONRPCNotification,
  isJSONRPCRequest,
  type RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";

import { mcpServerOperationDuration } from "./instruments.js";
import { startTimer } from "./scope.js";
import { ATTR_MCP_METHOD_NAME, ATTR_RPC_RESPONSE_STATUS_CODE } from "./semconv.js";

/** These record at their own chokepoints (`kernel/tool.ts`, `shared/resources.ts`), with richer attributes. */
const CHOKEPOINT_METHODS: ReadonlySet<string> = new Set<ClientRequest["method"]>(["tools/call", "resources/read"]);

/**
 * The method name is client input and becomes a metric label, so only known names
 * pass. `server/discover` isn't in the SDK's schema, but clients send it to probe
 * the server, and the answer is method-not-found.
 */
const KNOWN_METHODS: ReadonlySet<string> = new Set<
  ClientRequest["method"] | ClientNotification["method"] | "server/discover"
>([
  "completion/complete",
  "initialize",
  "logging/setLevel",
  "ping",
  "prompts/get",
  "prompts/list",
  "resources/list",
  "resources/subscribe",
  "resources/templates/list",
  "resources/unsubscribe",
  "server/discover",
  "tasks/cancel",
  "tasks/get",
  "tasks/list",
  "tasks/result",
  "tools/list",
  "notifications/cancelled",
  "notifications/initialized",
  "notifications/progress",
  "notifications/roots/list_changed",
  "notifications/tasks/status",
]);

/** Exported for tests. The semconv's value for a method outside the known set. */
export const OTHER_METHOD = "_OTHER";

const methodLabel = (method: string): string => (KNOWN_METHODS.has(method) ? method : OTHER_METHOD);

/**
 * Record one data point per client request (receipt to response) and notification
 * (synchronous dispatch only, since it has no response). A cancelled request gets
 * no response, so it records nothing.
 *
 * Call after `server.connect`, which installs the `onmessage` this wraps. A session
 * that replays `initialize` to rebuild itself should call this after the replay, so
 * the replay isn't counted as client traffic.
 */
export function recordMcpOperations(transport: Transport): void {
  const pending = new Map<RequestId, { readonly elapsedSeconds: () => number; readonly method: string }>();

  const deliver = transport.onmessage;
  transport.onmessage = (message, extra) => {
    if (isJSONRPCRequest(message)) {
      if (!CHOKEPOINT_METHODS.has(message.method)) {
        pending.set(message.id, { elapsedSeconds: startTimer(), method: methodLabel(message.method) });
      }
      deliver?.(message, extra);
      return;
    }
    if (!isJSONRPCNotification(message)) {
      deliver?.(message, extra);
      return;
    }

    // The protocol layer sends nothing for a cancelled request; drop its entry so
    // a client can't grow the map by cancelling requests.
    const cancelled = message.method === "notifications/cancelled" ? message.params?.["requestId"] : undefined;
    if (typeof cancelled === "string" || typeof cancelled === "number") pending.delete(cancelled);

    const elapsedSeconds = startTimer();
    deliver?.(message, extra);
    mcpServerOperationDuration().record(elapsedSeconds(), { [ATTR_MCP_METHOD_NAME]: methodLabel(message.method) });
  };

  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    // A message with a method is a server-initiated request or notification, not a response.
    const id = "id" in message && !("method" in message) ? message.id : undefined;
    const started = id === undefined ? undefined : pending.get(id);
    if (id !== undefined && started !== undefined) {
      pending.delete(id);
      const code = "error" in message ? message.error.code : undefined;
      mcpServerOperationDuration().record(started.elapsedSeconds(), {
        [ATTR_MCP_METHOD_NAME]: started.method,
        // The code, never the message: error text can carry client input.
        ...(code !== undefined && {
          [ATTR_ERROR_TYPE]: ErrorCode[code] ?? String(code),
          [ATTR_RPC_RESPONSE_STATUS_CODE]: String(code),
        }),
      });
    }
    return send(message, options);
  };
}
