import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ListResourcesCallback, ReadResourceTemplateCallback } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { DomainCtx, DomainId } from "./registry.js";

import { tracedResourceRead } from "../shared/resources.js";
import { sessionAttrs } from "../telemetry/client-fingerprint.js";

/**
 * One URI template within a resource family — its registration name (the
 * `resources/list` entry the SDK advertises), its URI template, and the
 * one-line description. A family is a {@link ResourceSpec.primary} plus any
 * read-only {@link ResourceSpec.aliases}.
 */
export interface ResourceTemplateSpec {
  readonly name: string;
  readonly uriTemplate: string;
  readonly description: string;
}

/**
 * A resource's registration metadata, **as data** — the resource-side sibling of
 * {@link import("./tool.js").ToolSpec}. Readable without booting the kernel, so the
 * doc generator can grow a resources section the same way it reads tool specs
 * (ADR-0011).
 *
 * Most resources are a single listable template: just `primary`. The photo
 * resource is the exception — two URI templates (a bare `…/photo` and a catch-all
 * `…/photo{+rest}`, because the SDK's matcher can't express an optional query)
 * routed to ONE read handler, so the extra template is an `alias`: a read-only URI
 * with no `list` of its own.
 *
 * `kind` is the telemetry kind + invoke-log label, shared across every template in
 * the family; it defaults to `primary.name`. The photo family overrides it so both
 * registration names (`recipe-photo`, `recipe-photo-sized`) record under one kind
 * (`recipe-photos`).
 */
export interface ResourceSpec {
  readonly primary: ResourceTemplateSpec;
  readonly aliases?: ReadonlyArray<ResourceTemplateSpec>;
  readonly kind?: string;
}

/**
 * The handlers a {@link defineResource} factory returns: the SDK `read` callback
 * (bound to the family's one read path) and an optional `list` enumerating the
 * `primary` template. Both close over the per-session {@link DomainCtx}, which is
 * why they come from a factory rather than the static spec — the `list` reads
 * `ctx.state`, exactly as the tool handler factory closes over ctx.
 */
export interface ResourceHandlers {
  readonly read: ReadResourceTemplateCallback;
  readonly list?: ListResourcesCallback;
}

/**
 * A registrable resource: its {@link ResourceSpec} (data the generator reads) plus
 * a `register` that binds the handlers to a per-session {@link DomainCtx} and calls
 * `server.registerResource`. The kernel iterates `resource.register(ctx)` in
 * `registerAll` exactly as it does `tool.register(ctx)`.
 */
export interface ResourceDef<State, Deps extends DomainId> {
  readonly spec: ResourceSpec;
  register(ctx: DomainCtx<State, Deps>): void;
}

/**
 * Author a resource: `defineResource(spec, ctx => ({ read, list }))`. The kernel's
 * `register` owns the cross-cutting wrap that resource files used to apply by hand:
 * - opens a `resources/read` span and records `mcp.server.operation.duration` via
 *   {@link tracedResourceRead} — so tracing is STRUCTURAL (a resource added later
 *   cannot ship untraced), the same property `defineTool` gives tools;
 * - logs a `resource read` line (info, `{ resource: kind }`) per read, the
 *   resource-side sibling of the tool wrapper's `tool invoked`.
 *
 * The factory runs once per `register(ctx)` (per session), so per-session setup —
 * e.g. the photo resource's bytes cache — lives in the factory body before the
 * returned handlers, exactly like a tool factory's per-registration setup.
 *
 * The `list` binds to the `primary` template; `aliases` register the same traced
 * read with no `list`. `tracedResourceRead` is throw-transparent (ADR-0014 form
 * #1): `resourceNotFound`'s `McpError` crosses it unchanged for the SDK to render.
 */
export function defineResource<State, Deps extends DomainId>(
  spec: ResourceSpec,
  factory: (ctx: DomainCtx<State, Deps>) => ResourceHandlers,
): ResourceDef<State, Deps> {
  return {
    spec,
    register(ctx) {
      const kind = spec.kind ?? spec.primary.name;
      const log = ctx.infra.log.child({ component: kind });
      const { read, list } = factory(ctx);
      // One traced handler shared by the primary and every alias: the span + metric
      // and the uniform invoke log live here, so an alias can't diverge.
      const tracedRead = tracedResourceRead(
        kind,
        async (...args: Parameters<ReadResourceTemplateCallback>) => {
          log.info({ resource: kind }, "resource read");
          return read(...args);
        },
        // Tag the read span with `mcp.session.id` (span-only) so a widget's render spans —
        // parented under this read via the smuggled traceparent — group by session.
        () => sessionAttrs(ctx.server.server),
      );
      const register = (t: ResourceTemplateSpec, listCb: ListResourcesCallback | undefined): void => {
        ctx.server.registerResource(
          t.name,
          new ResourceTemplate(t.uriTemplate, { list: listCb }),
          { description: t.description },
          tracedRead,
        );
      };
      register(spec.primary, list);
      for (const alias of spec.aliases ?? []) register(alias, undefined);
    },
  };
}
