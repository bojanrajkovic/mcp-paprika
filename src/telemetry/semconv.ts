// Vendored OpenTelemetry semantic-convention constants for the MCP and GenAI
// conventions, pinned to semconv spec v1.39.0 (the release that introduced the
// MCP conventions; both families carry Development stability).
//
// Vendored rather than imported from `@opentelemetry/semantic-conventions/incubating`
// on the package's own advice: the incubating entry point may break in MINOR
// versions, so instrumentation code is told to copy the definitions it uses
// (the same reasoning that vendored the vector index). Stable
// constants (`error.type`, `service.*`, `http.*`) ARE imported from the
// package's stable entry; only Development-status names live here. When the
// MCP/GenAI conventions stabilize, this file is the single rename site.

/** The MCP protocol method handled by a span (e.g. `tools/call`). */
export const ATTR_MCP_METHOD_NAME = "mcp.method.name";

/**
 * The MCP session id — the per-client session a request belongs to (HTTP transport;
 * stdio is one session per process and sets none). SPAN-ONLY: per-session, so
 * unbounded cardinality — never a metric label. Stamped on every tool-call and
 * resource-read span (and the widget render spans that hang under a read): it is the
 * cross-request grouping key for a turn, the inbound host trace id being per-request.
 */
export const ATTR_MCP_SESSION_ID = "mcp.session.id";

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

// The specs' advisory explicit-bucket boundaries are deliberately not
// vendored: every histogram exports as a base2 exponential histogram
// (sdk.ts), where the advisory boundaries — defined for the default
// explicit-bucket aggregation — never apply.
