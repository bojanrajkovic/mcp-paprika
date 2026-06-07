// The semconv-named instruments shared by more than one recording seam (the
// tool and resource chokepoints both feed `mcp.server.operation.duration`;
// both transports feed the session histogram). Single-seam custom counters
// live at their seam — only the shared, spec-named ones are centralized so
// the descriptor exists exactly once. Everything is `lazy` because the
// metrics API has no late-binding proxy (see scope.ts).
//
// No bucket advice anywhere: the SDK exports every histogram as a base2
// exponential histogram (sdk.ts), so the semconv specs' advisory explicit
// boundaries — which exist for the default explicit-bucket aggregation —
// would be dead configuration here.

import { type Histogram, ValueType } from "@opentelemetry/api";

import { getMeter, lazy } from "./scope.js";
import {
  METRIC_GEN_AI_CLIENT_OPERATION_DURATION,
  METRIC_GEN_AI_CLIENT_TOKEN_USAGE,
  METRIC_MCP_SERVER_OPERATION_DURATION,
  METRIC_MCP_SERVER_SESSION_DURATION,
} from "./semconv.js";

/** Server-side MCP operation latency; attrs: `mcp.method.name`, target, `error.type`. */
export const mcpServerOperationDuration: () => Histogram = lazy(() =>
  getMeter().createHistogram(METRIC_MCP_SERVER_OPERATION_DURATION, {
    description: "Duration of MCP server operations",
    unit: "s",
    valueType: ValueType.DOUBLE,
  }),
);

/** Which transport served a session/operation — custom-prefixed; shared by both transports' recordings. */
export const ATTR_MCP_PAPRIKA_TRANSPORT = "mcp_paprika.transport";

/** MCP session lifetime, recorded once at session close; attr: `mcp_paprika.transport`. */
export const mcpServerSessionDuration: () => Histogram = lazy(() =>
  getMeter().createHistogram(METRIC_MCP_SERVER_SESSION_DURATION, {
    description: "Duration of MCP server sessions",
    unit: "s",
    valueType: ValueType.DOUBLE,
  }),
);

/** Client-observed GenAI operation latency (embeddings, image generation). */
export const genAiClientOperationDuration: () => Histogram = lazy(() =>
  getMeter().createHistogram(METRIC_GEN_AI_CLIENT_OPERATION_DURATION, {
    description: "Duration of GenAI client operations",
    unit: "s",
    valueType: ValueType.DOUBLE,
  }),
);

/** Token consumption of GenAI requests, by `gen_ai.token.type`. */
export const genAiClientTokenUsage: () => Histogram = lazy(() =>
  getMeter().createHistogram(METRIC_GEN_AI_CLIENT_TOKEN_USAGE, {
    description: "Token usage of GenAI client operations",
    unit: "{token}",
  }),
);
