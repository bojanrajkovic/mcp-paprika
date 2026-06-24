import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { context, trace } from "@opentelemetry/api";
import type { Result } from "neverthrow";
import type { ZodRawShape, ZodType, ZodTypeAny } from "zod";

import type { TypedCallToolResult } from "../shared/tools.js";
import type { DomainCtx, DomainId } from "./registry.js";

import { UI_RESOURCE_URI_META_KEY } from "../shared/mcp-app.js";
import { clientAttrs } from "../telemetry/client-fingerprint.js";
import { mcpServerOperationDuration } from "../telemetry/instruments.js";
import { getTracer } from "../telemetry/scope.js";
import { ATTR_GEN_AI_OPERATION_NAME, ATTR_GEN_AI_TOOL_NAME, ATTR_MCP_METHOD_NAME } from "../telemetry/semconv.js";
import { errorTypeName, startOperation } from "../telemetry/trace-result.js";

/**
 * A tool's registration metadata, **as data** — everything `registerTool` needs
 * except the handler. Splitting this out is what lets the doc generator read the
 * tool surface by importing the tool modules and reading `spec`, with no kernel
 * boot and no `McpServer` introspection.
 *
 * `inputSchema` is `ZodRawShape | ZodTypeAny`, exactly the two forms the SDK's
 * `registerTool` accepts: a raw shape (`{ field: z.string(), … }` — most tools)
 * OR a whole Zod object (the `.strict()` write schemas, where `.strict()` is
 * load-bearing and `.shape` would discard it). The generic `I` threads that form
 * through to the handler so `args` infers correctly either way — the same generic
 * the SDK's own `registerTool` uses, so this helper adds no casts of its own.
 *
 * `title` and `annotations` are REQUIRED: every tool in the surface supplies both,
 * and forcing them keeps the generated reference's read-only / destructive /
 * idempotent hints complete.
 *
 * `outputSchema` is OPTIONAL: when `O` is a concrete record type the field must
 * be a `ZodType<O>`, and TypeScript enforces that the handler's return type is
 * `TypedCallToolResult<O>` — either a success result carrying `structuredContent: O`
 * or an `isError: true` error result. That `O` generic threads enforcement to the
 * handler return type, so a schema-bearing write tool that calls `commitFailure`
 * without `structuredContent` is a compile-time error, as is returning
 * `toolResult(text)` (no structured payload) from a schema-bearing handler. When
 * `O = void` (the default, no `outputSchema` declared), `outputSchema` must be
 * absent (`never`), and the handler return type collapses to plain `CallToolResult`
 * — non-schema tools are completely unchanged. Per-tool payload typing still lives
 * at the authoring site via `z.infer`; the `O` generic threads the enforcement, not
 * the payload shape. Most tools omit it; the SDK's output validation is a no-op
 * until a tool declares one.
 *
 * `ui` is OPTIONAL and names the `ui://widget/{name}` resource a host renders for
 * this tool's result (ADR-0019). Like `outputSchema` it is plain data threaded
 * through the one `registerTool` seam — not a generic — and most tools omit it.
 * When set, the seam maps it onto the SDK config's `_meta` (the nested
 * `_meta.ui.resourceUri` the apps surface reads, plus the legacy flat key); when
 * unset, no `_meta` is emitted and the advertised tool is byte-for-byte unchanged.
 * A host without the apps surface ignores `_meta.ui` and shows the text result, so
 * the widget surface is additive.
 */
export interface ToolSpec<
  I extends ZodRawShape | ZodTypeAny = ZodRawShape | ZodTypeAny,
  O extends Record<string, unknown> | void = void,
> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  readonly inputSchema: I;
  readonly outputSchema?: O extends Record<string, unknown> ? ZodType<O> : never;
  readonly ui?: { readonly resourceUri: string };
}

/**
 * A registrable tool: its {@link ToolSpec} (data the generator reads) plus a
 * `register` that binds the handler to a per-session {@link DomainCtx} and calls
 * `server.registerTool`. The kernel iterates `tool.register(ctx)` in `registerAll`
 * — the data/behavior split means the SAME `spec` object drives both registration
 * and documentation, so the two cannot drift in content.
 *
 * `Writes` is the module's write-chokepoint surface (`ctx.writes`); it defaults to
 * empty, so a read-only tool keeps a two-generic `DomainCtx<State, Deps>`. A write
 * tool annotates the third generic to reach its module's commit chokepoints.
 */
export interface ToolDef<State, Deps extends DomainId, Writes = Record<never, never>> {
  readonly spec: ToolSpec<ZodRawShape | ZodTypeAny, Record<string, unknown> | void>;
  register(ctx: DomainCtx<State, Deps, Writes>): void;
}

/**
 * A tool readiness gate: `ok` to proceed, or `err` carrying the complete
 * {@link CallToolResult} to return instead of running the body.
 *
 * Declare a guard over the **narrowest ctx slice it needs** — `{ state: XState }`
 * for a domain's own cold-start gate, a deps-bearing `DomainCtx` for a
 * cross-domain gate. Parameter contravariance lets any richer tool ctx flow into
 * the narrower parameter, so one guard slots into every tool of its domain
 * without per-tool adapters.
 */
export type ToolPrecondition<Ctx> = (ctx: Ctx) => Result<void, CallToolResult>;

/**
 * The runtime shape every registered callback shares. A {@link ToolSpec} always
 * carries an `inputSchema`, so `ToolCallback<I>` always resolves to the
 * two-parameter `(args, extra)` form — but with `I` generic the conditional stays
 * unresolved inside `defineTool`, so the gate wrapper flows through this erased
 * shape and re-asserts `ToolCallback<I>` at the `registerTool` edge. This is the
 * tool-side sibling of `defineModule`'s single `ErasedModule` cast:
 * the kernel is a type-agnostic transport; the real safety lives at the
 * fully-checked authoring surface (the overloads below).
 */
type ErasedToolCallback = (args: unknown, extra: unknown) => CallToolResult | Promise<CallToolResult>;

/**
 * The handler-body type a {@link defineTool} factory must return: an SDK callback
 * whose `(args, extra)` parameter shapes are exactly those `ToolCallback<I>`
 * derives from the input schema, but with its RESULT narrowed to
 * {@link TypedCallToolResult `TypedCallToolResult<O>`}. Re-deriving the parameters
 * via `infer A` / `infer E` (rather than `ToolCallback<I>` outright) is what swaps
 * the return type while preserving `args`'s schema-typed shape — that is the seam
 * that threads `O` into the handler, so a schema-bearing tool that returns
 * `toolResult(text)` with no structured payload, or calls `commitFailure` without
 * `structuredContent`, fails to compile. When `O = void` the result collapses to
 * `CallToolResult` and the constraint is the same one `ToolCallback<I>` always
 * imposed, so non-schema tools are unchanged. A handler may take just `(args)`:
 * a function of fewer parameters is assignable to one of more, so the `extra`
 * parameter stays optional at the authoring site exactly as before.
 *
 * `NoInfer<O>` on the return is load-bearing: `O` must infer from `spec.outputSchema`
 * (the `ToolSpec<I, O>` argument) BEFORE the body is checked, never FROM the body. With
 * a still-inferrable `O`, TypeScript checks the handler in function-position, where the
 * RETURN type is compared bivariantly — and a broad `CallToolResult` (its `.passthrough()`
 * index signature `[k: string]: unknown` weakly "satisfies" `structuredContent: O`) slips
 * through, so a handler returning `commitFailure(...)` without `structuredContent`, or any
 * bare `CallToolResult`, would wrongly compile. Pinning `O` first makes each `return` a
 * strict direct-assignment check against the concrete `TypedCallToolResult<O>`, closing
 * that hole. The compile-time negatives are pinned in `tool.type.test.ts`.
 */
type TypedToolBody<I extends ZodRawShape | ZodTypeAny, O extends Record<string, unknown> | void> =
  ToolCallback<I> extends (args: infer A, extra: infer E) => unknown
    ? (args: A, extra: E) => TypedCallToolResult<NoInfer<O>> | Promise<TypedCallToolResult<NoInfer<O>>>
    : never;

const TOOLS_CALL_METHOD = "tools/call";

/** Which precondition gated a call — custom-prefixed; the MCP conventions define no gate concept. */
const ATTR_TOOL_GATED_BY = "mcp_paprika.tool.gated_by";

/** Whether the result carried `structuredContent` — the structured-output channel signal, sliceable by the client fingerprint on the same span. */
const ATTR_TOOL_STRUCTURED_OUTPUT = "mcp_paprika.tool.structured_output";

const MAX_LOGGED_STRING = 256;

/**
 * Sanitize a tool's args for the debug invoke log, recursively. Tool inputs are
 * Zod-validated plain data (no cycles), and the correlation fields the log
 * exists for (uids, names, dates) are short and survive untouched. Two string
 * shapes are rewritten:
 * - **URL-shaped strings** are stripped to protocol + host + path with the
 *   query replaced by a marker: credentials embed INSIDE url strings (userinfo
 *   `user:pass@host`, presigned-URL signatures in the query), where the
 *   key-name-based `REDACT_PATHS` cannot see, and a short signed URL would
 *   sail under the length gate.
 * - **Oversized strings** (past {@link MAX_LOGGED_STRING}) become a length
 *   marker — a ~13 MB base64 image or a full recipe's directions is payload,
 *   not correlation data.
 * Sensitive key NAMES (`generation_token`, `token`, …) are the root logger's
 * job — `REDACT_PATHS` in `utils/log.ts` censors them on every log site, not
 * just this one.
 */
function loggableArgs(value: unknown): unknown {
  if (typeof value === "string") return loggableString(value);
  if (Array.isArray(value)) return value.map(loggableArgs);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, loggableArgs(v)]));
  }
  return value;
}

function loggableString(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && URL.canParse(value)) {
    const url = new URL(value);
    // protocol + host excludes userinfo by construction; the query (where
    // presigned-URL credentials live) collapses to a marker.
    const sanitized = `${url.protocol}//${url.host}${url.pathname}${url.search.length > 0 ? "?[redacted]" : ""}`;
    return sanitized.length > MAX_LOGGED_STRING ? `[url, ${value.length.toString()} chars]` : sanitized;
  }
  return value.length > MAX_LOGGED_STRING ? `[${value.length.toString()} chars]` : value;
}

/**
 * Author a tool: `defineTool(spec, ctx => handler)`, or with readiness gates
 * `defineTool(spec, [pre1, pre2], ctx => handler)` (Express-middleware style).
 * The handler is a factory that receives the narrowed {@link DomainCtx}
 * and returns the SDK callback — the factory body holds per-registration setup
 * (e.g. a child logger the body logs through), and the returned callback is the
 * tool body.
 *
 * The kernel wraps every registered callback once:
 * - logs `tool invoked` (uniform `{ tool }` shape, info) BEFORE the gate, so a
 *   gated call is still visible, plus the full `args` at debug for per-call
 *   correlation;
 * - opens a `tools/call {name}` span (INTERNAL — under HTTP the transport
 *   middleware owns the SERVER span, and the GenAI `execute_tool` convention
 *   wants INTERNAL) covering the gate chain AND the body, and records
 *   `mcp.server.operation.duration` once per call. Outcomes class via
 *   `error.type`: an `isError` result is `tool_error` (span status ERROR); a
 *   gated call is `precondition_gated` with the guard's name on
 *   `mcp_paprika.tool.gated_by` but status UNSET — gating is expected
 *   cold-start state, the same reasoning as its debug-not-info log line. Args
 *   never become attributes (UIDs and payloads stay out of telemetry);
 * - runs the {@link ToolPrecondition} chain in order, short-circuiting on the
 *   first `err` — that err IS the tool result, and the failing guard's function
 *   name is logged at debug (gating is expected cold-start state, not an
 *   incident). The gate's `.match()` lives here once, so tool bodies start
 *   flat instead of inside an ok-arm.
 *
 * `I` is inferred from `spec.inputSchema` (so `handler`'s `args` is typed from the
 * schema); `O` is inferred from `spec.outputSchema` when provided (a `ZodType<O>`
 * constrains the handler's return type to `TypedCallToolResult<O>`, enforcing that
 * schema-bearing tools carry `structuredContent: O` on success and `isError: true`
 * on non-success — so returning `toolResult(text)` without a payload, or calling
 * `commitFailure` without `structuredContent`, is a compile-time error); when omitted
 * `O = void` and the handler return type collapses to `CallToolResult`.
 * `State`/`Deps`/`Writes` are inferred from the `ctx` parameter's annotation
 * (`ctx: DomainCtx<FooState, "dep", FooWrites>`), which doubles as the tool's
 * dependency declaration — a read-only tool omits the third generic and `Writes`
 * defaults to empty. The handler annotation drives that inference even in the
 * three-arg form: the annotated factory is not context-sensitive, so it contributes
 * its candidates in TS's first inference round, and the precondition array is then
 * checked against the settled ctx (contravariance admits narrower guard params). Do
 * NOT wrap the array's ctx in `NoInfer`: contextually typing an inline-arrow guard
 * would then fix the generics to their constraints BEFORE the handler is processed
 * (args resolve left-to-right), collapsing `State` to `unknown`. Registration maps
 * the {@link ToolSpec} to the SDK's `registerTool` config explicitly: `name` is the
 * positional argument, and the remaining fields (`title`/`description`/`inputSchema`/
 * `annotations`, plus `outputSchema` when a tool declares one and `_meta` derived from
 * `ui` when a tool declares that) become the config object. That explicit literal is
 * the single seam through which a spec field is threaded into the advertised surface —
 * `outputSchema` and the `ui` → `_meta` UI-resource mapping.
 */
export function defineTool<
  I extends ZodRawShape | ZodTypeAny,
  O extends Record<string, unknown> | void,
  State,
  Deps extends DomainId,
  Writes = Record<never, never>,
>(
  spec: ToolSpec<I, O>,
  handler: (ctx: DomainCtx<State, Deps, Writes>) => TypedToolBody<I, O>,
): ToolDef<State, Deps, Writes>;
export function defineTool<
  I extends ZodRawShape | ZodTypeAny,
  O extends Record<string, unknown> | void,
  State,
  Deps extends DomainId,
  Writes = Record<never, never>,
>(
  spec: ToolSpec<I, O>,
  preconditions: ReadonlyArray<ToolPrecondition<DomainCtx<State, Deps, Writes>>>,
  handler: (ctx: DomainCtx<State, Deps, Writes>) => TypedToolBody<I, O>,
): ToolDef<State, Deps, Writes>;
export function defineTool<
  I extends ZodRawShape | ZodTypeAny,
  O extends Record<string, unknown> | void,
  State,
  Deps extends DomainId,
  Writes = Record<never, never>,
>(
  spec: ToolSpec<I, O>,
  preconditionsOrHandler:
    | ReadonlyArray<ToolPrecondition<DomainCtx<State, Deps, Writes>>>
    | ((ctx: DomainCtx<State, Deps, Writes>) => ToolCallback<I>),
  maybeHandler?: (ctx: DomainCtx<State, Deps, Writes>) => ToolCallback<I>,
): ToolDef<State, Deps, Writes> {
  // The overloads guarantee the pairing; this narrow just routes the two forms.
  // (The explicit annotation matters: `Array.isArray` narrows a `ReadonlyArray |
  // function` union to `any[]`, which would leak `any` into the gate loop.)
  const hasPreconditions = Array.isArray(preconditionsOrHandler);
  const preconditions: ReadonlyArray<ToolPrecondition<DomainCtx<State, Deps, Writes>>> = hasPreconditions
    ? preconditionsOrHandler
    : [];
  const handler = (hasPreconditions ? maybeHandler : preconditionsOrHandler) as (
    ctx: DomainCtx<State, Deps, Writes>,
  ) => ToolCallback<I>;

  return {
    spec,
    register(ctx) {
      const log = ctx.infra.log.child({ component: spec.name });
      const body = handler(ctx) as ErasedToolCallback;
      // Per-registration constants, hoisted off the per-call path: the span
      // name and every attribute except error.type are fixed per tool.
      const spanName = `${TOOLS_CALL_METHOD} ${spec.name}`;
      const spanAttributes = {
        [ATTR_MCP_METHOD_NAME]: TOOLS_CALL_METHOD,
        [ATTR_GEN_AI_OPERATION_NAME]: "execute_tool",
        [ATTR_GEN_AI_TOOL_NAME]: spec.name,
      } as const;
      const metricAttributes = {
        [ATTR_MCP_METHOD_NAME]: TOOLS_CALL_METHOD,
        [ATTR_GEN_AI_TOOL_NAME]: spec.name,
      } as const;
      const gated: ErasedToolCallback = (args, extra) => {
        log.info({ tool: spec.name }, "tool invoked");
        // Args ride a separate debug line: per-call correlation (which UID, which
        // list) is recoverable by raising the level, without putting recipe-sized
        // payloads in info logs. Size-bounded (oversized strings become length
        // markers) and the root logger's REDACT_PATHS censors credential-named
        // fields; the level guard keeps the walk off the default-level path.
        if (log.isLevelEnabled("debug")) log.debug({ tool: spec.name, args: loggableArgs(args) }, "tool args");
        const op = startOperation(
          getTracer(),
          spanName,
          { attributes: spanAttributes },
          { histogram: mcpServerOperationDuration, attributes: metricAttributes },
        );
        // Tag the span (not the metric) with the connecting client's census slice
        // — name + major version + transport — so the structured-output channel can
        // be sliced by host without inflating the operation-duration histogram's
        // series count. Empty until the handshake fingerprint is recorded.
        op.span.setAttributes(clientAttrs(ctx.server.server));
        // The protocol adapters: finish maps the SDK's CallToolResult outcomes
        // onto op.end (the doc-comment above carries the outcome-classing
        // rationale — gated keeps status UNSET); fail is the throw-transparent
        // passthrough for the SDK's throw-based callback contract.
        const finish = (result: CallToolResult, gateErrorType?: string): CallToolResult => {
          const errorType = gateErrorType ?? (result.isError === true ? "tool_error" : undefined);
          // Whether the result used the structured-output channel — set on the span
          // (sliceable by the client fingerprint above), and on the completion log.
          const structuredOutput = result.structuredContent !== undefined;
          op.span.setAttribute(ATTR_TOOL_STRUCTURED_OUTPUT, structuredOutput);
          op.end({ errorType, isError: errorType === "tool_error" });
          // Uniform per-call completion line (info, matching the "tool invoked"
          // open) closing every call with its outcome; the client fingerprint is on
          // the span (pivot via trace_id). The full args stay on the separate debug line.
          log.info(
            {
              tool: spec.name,
              structuredOutput,
              isError: result.isError === true,
              ...(gateErrorType !== undefined && { gated: true }),
            },
            "tool completed",
          );
          return result;
        };
        const fail = (cause: unknown): never => {
          // A throw carried no structured result; record the attribute + a matching
          // completion line so every "tool invoked" pairs with a "tool completed"
          // and a thrown call is not an orphan invocation in the span/log stream.
          op.span.setAttribute(ATTR_TOOL_STRUCTURED_OUTPUT, false);
          op.end({ errorType: errorTypeName(cause), isError: true, exception: cause });
          log.info({ tool: spec.name, structuredOutput: false, isError: true, threw: true }, "tool completed");
          throw cause;
        };
        // The guard chain runs inside the same try as the body, so even a
        // contract-breaking guard throw routes through fail() instead of
        // leaking the operation.
        try {
          for (const pre of preconditions) {
            const failure = pre(ctx).match(
              () => undefined,
              (result) => result,
            );
            if (failure !== undefined) {
              // debug, not info: gating is the expected, self-healing cold-start
              // state, and a retrying client would otherwise storm the info log
              // with one gate line per call across the whole surface.
              log.debug({ tool: spec.name, precondition: pre.name || "(inline)" }, "tool gated by precondition");
              op.span.setAttribute(ATTR_TOOL_GATED_BY, pre.name || "(inline)");
              // Normalize the gate failure to an `isError` result. Once a tool
              // declares an `outputSchema`, the SDK validates every NON-error result
              // — and a gated response is the guard's result — so a non-error gate
              // result with no `structuredContent` would be rejected and its message
              // replaced by a generic schema error. Marking every precondition-gate
              // failure `isError` here exempts it from that validation (the SDK skips
              // `isError` results), so guards never need to know which tools declare a
              // schema: they return a plain `toolResult` and the kernel flags it. A
              // gate failure genuinely IS an error. (Contract pinned in
              // `tool.e2e.test.ts`; the span keeps its `precondition_gated` errorType,
              // so this does not change gating telemetry.)
              return finish({ ...failure, isError: true }, "precondition_gated");
            }
          }
          // context.with makes this span active for the body, so spans started
          // inside it (undici fetches, feature pipelines) parent correctly.
          const outcome = context.with(trace.setSpan(context.active(), op.span), () => body(args, extra));
          return outcome instanceof Promise ? outcome.then(finish, fail) : finish(outcome);
        } catch (cause) {
          return fail(cause);
        }
      };
      // Map the spec to the SDK's registerTool config explicitly: `name` is the
      // positional argument, not a config key. This is the single seam that threads
      // a spec field the SDK config accepts under a different shape than `ToolSpec`
      // names it — `outputSchema` (A1) and the `ui` → `_meta` UI-resource mapping
      // (C1, ADR-0019). The SDK advertises `outputSchema` in tools/list and
      // validates a tool's `structuredContent` against it; the `_meta` rides into
      // the advertisement so a host fetches and renders the named `ui://` widget.
      // Both keys are `&&`-elided: `spec.outputSchema` (a Zod schema) and `spec.ui`
      // (an object) are always truthy when present, so the key is omitted when
      // unset — required under exactOptionalPropertyTypes, which rejects an explicit
      // `outputSchema: undefined` / `_meta: undefined`. The `_meta` carries the
      // preferred nested `ui.resourceUri` AND the legacy flat key (mirroring
      // ext-apps' registerAppTool) so an older host reading only the flat key still
      // resolves the widget.
      ctx.server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations,
          ...(spec.outputSchema && { outputSchema: spec.outputSchema }),
          ...(spec.ui && {
            _meta: {
              ui: { resourceUri: spec.ui.resourceUri },
              [UI_RESOURCE_URI_META_KEY]: spec.ui.resourceUri,
            },
          }),
        },
        gated as ToolCallback<I>,
      );
    },
  };
}
