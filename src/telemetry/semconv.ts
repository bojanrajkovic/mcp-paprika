// pattern: Functional Core
//
// Vendored OpenTelemetry semantic-convention constants for the MCP and GenAI
// conventions, pinned to semconv spec v1.39.0 (the release that introduced the
// MCP conventions; both families carry Development stability).
//
// Vendored rather than imported from `@opentelemetry/semantic-conventions/incubating`
// on the package's own advice: the incubating entry point may break in MINOR
// versions, so instrumentation code is told to copy the definitions it uses
// (the same reasoning that vendored the vector index — ADR-0003). Stable
// constants (`error.type`, `service.*`, `http.*`) ARE imported from the
// package's stable entry; only Development-status names live here. When the
// MCP/GenAI conventions stabilize, this file is the single rename site.

/** The MCP protocol method handled by a span (e.g. `tools/call`). */
export const ATTR_MCP_METHOD_NAME = "mcp.method.name";

/** The kind of GenAI operation a span describes (`execute_tool`, `embeddings`, `generate_content`, …). */
export const ATTR_GEN_AI_OPERATION_NAME = "gen_ai.operation.name";

/** Tool name on `execute_tool` spans; set only when the span describes a tool call. */
export const ATTR_GEN_AI_TOOL_NAME = "gen_ai.tool.name";

/** The GenAI provider serving the request (`openai`-compatible hosts, `openrouter`, …). */
export const ATTR_GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";

/** The model name the request asked for. */
export const ATTR_GEN_AI_REQUEST_MODEL = "gen_ai.request.model";

/** The concrete model that served the response (may differ from the request behind a router). */
export const ATTR_GEN_AI_RESPONSE_MODEL = "gen_ai.response.model";

/** Token-class discriminator on `gen_ai.client.token.usage` (`input` | `output`). */
export const ATTR_GEN_AI_TOKEN_TYPE = "gen_ai.token.type";

/** Input-token count consumed by a GenAI request (span attribute). */
export const ATTR_GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens";

/** Server-side duration of an MCP operation, in seconds. */
export const METRIC_MCP_SERVER_OPERATION_DURATION = "mcp.server.operation.duration";

/** Total lifetime of an MCP server session, in seconds. */
export const METRIC_MCP_SERVER_SESSION_DURATION = "mcp.server.session.duration";

/** Client-observed duration of a GenAI operation, in seconds. */
export const METRIC_GEN_AI_CLIENT_OPERATION_DURATION = "gen_ai.client.operation.duration";

/** Token consumption of GenAI requests, by `gen_ai.token.type`. */
export const METRIC_GEN_AI_CLIENT_TOKEN_USAGE = "gen_ai.client.token.usage";

/**
 * Spec-advised buckets for the `mcp.*.duration` histograms: dense sub-second
 * resolution for ordinary operations, a tail out to 300 s for long-running
 * sessions and slow tools.
 */
export const MCP_DURATION_BUCKETS: ReadonlyArray<number> = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300,
];

/**
 * Spec-advised buckets for `gen_ai.client.operation.duration`: a geometric
 * doubling series, because LLM-class calls legitimately stretch from tens of
 * milliseconds (embeddings) to >80 s (image generation).
 */
export const GEN_AI_DURATION_BUCKETS: ReadonlyArray<number> = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92,
];

/** Spec-advised buckets for `gen_ai.client.token.usage` (powers of four). */
export const GEN_AI_TOKEN_USAGE_BUCKETS: ReadonlyArray<number> = [
  1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864,
];
