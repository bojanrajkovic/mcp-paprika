// pattern: Functional Core
//
// The semconv-named instruments shared by more than one recording seam (the
// tool and resource chokepoints both feed `mcp.server.operation.duration`;
// both transports feed the session histogram). Single-seam custom counters
// live at their seam — only the shared, spec-named ones are centralized so
// the descriptor (unit, bucket advice) exists exactly once. Everything is
// `lazy` because the metrics API has no late-binding proxy (see scope.ts).

import { type Histogram, ValueType } from "@opentelemetry/api";

import { getMeter, lazy } from "./scope.js";
import {
  GEN_AI_DURATION_BUCKETS,
  MCP_DURATION_BUCKETS,
  METRIC_GEN_AI_CLIENT_OPERATION_DURATION,
  METRIC_MCP_SERVER_OPERATION_DURATION,
  METRIC_MCP_SERVER_SESSION_DURATION,
} from "./semconv.js";

/** Server-side MCP operation latency; attrs: `mcp.method.name`, target, `error.type`. */
export const mcpServerOperationDuration: () => Histogram = lazy(() =>
  getMeter().createHistogram(METRIC_MCP_SERVER_OPERATION_DURATION, {
    description: "Duration of MCP server operations",
    unit: "s",
    valueType: ValueType.DOUBLE,
    advice: { explicitBucketBoundaries: [...MCP_DURATION_BUCKETS] },
  }),
);

/** MCP session lifetime, recorded once at session close; attr: `mcp_paprika.transport`. */
export const mcpServerSessionDuration: () => Histogram = lazy(() =>
  getMeter().createHistogram(METRIC_MCP_SERVER_SESSION_DURATION, {
    description: "Duration of MCP server sessions",
    unit: "s",
    valueType: ValueType.DOUBLE,
    advice: { explicitBucketBoundaries: [...MCP_DURATION_BUCKETS] },
  }),
);

/** Client-observed GenAI operation latency (embeddings, image generation). */
export const genAiClientOperationDuration: () => Histogram = lazy(() =>
  getMeter().createHistogram(METRIC_GEN_AI_CLIENT_OPERATION_DURATION, {
    description: "Duration of GenAI client operations",
    unit: "s",
    valueType: ValueType.DOUBLE,
    advice: { explicitBucketBoundaries: [...GEN_AI_DURATION_BUCKETS] },
  }),
);
