import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
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
 */
export interface ToolDef<Self, Deps extends DomainId> {
  readonly spec: ToolSpec;
  register(ctx: DomainCtx<Self, Deps>): void;
}

/**
 * Author a tool: `defineTool(spec, ctx => handler)`. The handler is a factory that
 * receives the narrowed {@link DomainCtx} and returns the SDK callback — so the
 * factory body holds the per-registration setup (e.g. the child logger) the old
 * `fooTool(ctx)` function held before its `registerTool` call, and the returned
 * callback is the old handler.
 *
 * `I` is inferred from `spec.inputSchema` (so `handler`'s `args` is typed from the
 * schema); `Self`/`Deps` are inferred from the `ctx` parameter's annotation
 * (`ctx: DomainCtx<FooSelf, "dep">`), which doubles as the tool's dependency
 * declaration exactly as the old function signature did. Registration is delegated
 * straight to `server.registerTool(name, spec, cb)`: `spec` carries an extra `name`
 * the SDK config ignores, which is fine — it is passed as a value, not an object
 * literal, so no excess-property error.
 */
export function defineTool<I extends ZodRawShape | ZodTypeAny, Self, Deps extends DomainId>(
  spec: ToolSpec<I>,
  handler: (ctx: DomainCtx<Self, Deps>) => ToolCallback<I>,
): ToolDef<Self, Deps> {
  return {
    spec,
    register(ctx) {
      ctx.server.registerTool(spec.name, spec, handler(ctx));
    },
  };
}
