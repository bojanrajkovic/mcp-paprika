import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Result } from "neverthrow";
import type { ZodRawShape, ZodTypeAny } from "zod";

import type { DomainCtx, DomainId } from "./registry.js";

/**
 * A tool's registration metadata, **as data** — everything `registerTool` needs
 * except the handler. Splitting this out is what lets the doc generator read the
 * tool surface by importing the tool modules and reading `spec`, with no kernel
 * boot and no `McpServer` introspection (ADR-0011).
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
 */
export interface ToolSpec<I extends ZodRawShape | ZodTypeAny = ZodRawShape | ZodTypeAny> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  readonly inputSchema: I;
}

/**
 * A registrable tool: its {@link ToolSpec} (data the generator reads) plus a
 * `register` that binds the handler to a per-session {@link DomainCtx} and calls
 * `server.registerTool`. The kernel iterates `tool.register(ctx)` in `registerAll`
 * — the data/behavior split means the SAME `spec` object drives both registration
 * and documentation, so the two cannot drift in content (ADR-0011).
 *
 * `Writes` is the module's write-chokepoint surface (`ctx.writes`); it defaults to
 * empty, so a read-only tool keeps a two-generic `DomainCtx<State, Deps>`. A write
 * tool annotates the third generic to reach its module's commit chokepoints.
 */
export interface ToolDef<State, Deps extends DomainId, Writes = Record<never, never>> {
  readonly spec: ToolSpec;
  register(ctx: DomainCtx<State, Deps, Writes>): void;
}

/**
 * A tool readiness gate: `ok` to proceed, or `err` carrying the complete
 * {@link CallToolResult} to return instead of running the body (ADR-0015).
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
 * tool-side sibling of `defineModule`'s single `ErasedModule` cast (ADR-0009 §1):
 * the kernel is a type-agnostic transport; the real safety lives at the
 * fully-checked authoring surface (the overloads below).
 */
type ErasedToolCallback = (args: unknown, extra: unknown) => CallToolResult | Promise<CallToolResult>;

/**
 * Author a tool: `defineTool(spec, ctx => handler)`, or with readiness gates
 * `defineTool(spec, [pre1, pre2], ctx => handler)` (Express-middleware style;
 * ADR-0015). The handler is a factory that receives the narrowed {@link DomainCtx}
 * and returns the SDK callback — the factory body holds per-registration setup
 * (e.g. a child logger the body logs through), and the returned callback is the
 * tool body.
 *
 * The kernel wraps every registered callback once:
 * - logs `tool invoked` (uniform `{ tool }` shape, info) BEFORE the gate, so a
 *   gated call is still visible, plus the full `args` at debug for per-call
 *   correlation;
 * - runs the {@link ToolPrecondition} chain in order, short-circuiting on the
 *   first `err` — that err IS the tool result, and the failing guard's function
 *   name is logged at debug (gating is expected cold-start state, not an
 *   incident). The gate's `.match()` lives here once, so tool bodies start
 *   flat instead of inside an ok-arm.
 *
 * `I` is inferred from `spec.inputSchema` (so `handler`'s `args` is typed from the
 * schema); `State`/`Deps`/`Writes` are inferred from the `ctx` parameter's
 * annotation (`ctx: DomainCtx<FooState, "dep", FooWrites>`), which doubles as the
 * tool's dependency declaration — a read-only tool omits the third generic and
 * `Writes` defaults to empty. The handler annotation drives that inference even in
 * the three-arg form: the annotated factory is not context-sensitive, so it
 * contributes its candidates in TS's first inference round, and the precondition
 * array is then checked against the settled ctx (contravariance admits narrower
 * guard params). Do NOT wrap the array's ctx in `NoInfer`: contextually typing an
 * inline-arrow guard would then fix the generics to their constraints BEFORE the
 * handler is processed (args resolve left-to-right), collapsing `State` to
 * `unknown`. Registration is delegated straight to
 * `server.registerTool(name, spec, cb)`: `spec` carries an extra `name` the SDK
 * config ignores, which is fine — it is passed as a value, not an object literal,
 * so no excess-property error.
 */
export function defineTool<
  I extends ZodRawShape | ZodTypeAny,
  State,
  Deps extends DomainId,
  Writes = Record<never, never>,
>(spec: ToolSpec<I>, handler: (ctx: DomainCtx<State, Deps, Writes>) => ToolCallback<I>): ToolDef<State, Deps, Writes>;
export function defineTool<
  I extends ZodRawShape | ZodTypeAny,
  State,
  Deps extends DomainId,
  Writes = Record<never, never>,
>(
  spec: ToolSpec<I>,
  preconditions: ReadonlyArray<ToolPrecondition<DomainCtx<State, Deps, Writes>>>,
  handler: (ctx: DomainCtx<State, Deps, Writes>) => ToolCallback<I>,
): ToolDef<State, Deps, Writes>;
export function defineTool<
  I extends ZodRawShape | ZodTypeAny,
  State,
  Deps extends DomainId,
  Writes = Record<never, never>,
>(
  spec: ToolSpec<I>,
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
      const gated: ErasedToolCallback = (args, extra) => {
        log.info({ tool: spec.name }, "tool invoked");
        // Args ride a separate debug line: per-call correlation (which UID, which
        // list) is recoverable by raising the level, without putting recipe-sized
        // payloads in info logs. The root logger's redaction still applies.
        log.debug({ tool: spec.name, args }, "tool args");
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
            return failure;
          }
        }
        return body(args, extra);
      };
      ctx.server.registerTool(spec.name, spec, gated as ToolCallback<I>);
    },
  };
}
