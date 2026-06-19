/**
 * Advertised-surface e2e for {@link defineTool}'s registration.
 *
 * `tool.test.ts` drives tools through `makeTestServer`, whose stub discards the
 * `registerTool` config — so it proves handler routing but is blind to what
 * `tools/list` advertises. This file registers a tool on a real
 * {@link buildBrandedServer} and reads it back over the SDK's in-memory
 * transport (see `test/support/in-memory-mcp.ts`), so it anchors the explicit
 * spec→config mapping in `register`: every `ToolSpec` field must land in the
 * advertised tool, `name` must come from the positional argument (it is dropped
 * from the config object), and a declared `outputSchema` rides into the
 * advertisement (A1 #306) while a tool that omits it advertises none (the
 * `&&`-elision must not leak an empty key). A declared `ui` rides into the
 * advertisement's `_meta` as both the nested `ui.resourceUri` and the legacy flat
 * key (C1 #324, ADR-0019), while a tool that omits it advertises no `_meta`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { DomainCtx, Infra } from "./registry.js";

import { connectInMemoryMcp } from "../../test/support/in-memory-mcp.js";
import { buildBrandedServer } from "../server/build.js";
import { UI_RESOURCE_URI_META_KEY } from "../shared/mcp-app.js";
import { toolResult } from "../shared/tools.js";
import { SILENT_LOG } from "../utils/log.js";
import { defineTool } from "./tool.js";

/**
 * A minimal {@link DomainCtx} for registering a synthetic tool against a real
 * server: `register` only touches `infra.log` and `server`, and these tools
 * ignore `state`/`deps`/`writes`, so the rest is cast (cf. `tool.test.ts`).
 */
function makeCtx(server: McpServer): DomainCtx<unknown, never> {
  return { state: undefined, writes: {}, deps: {}, infra: { log: SILENT_LOG } as unknown as Infra, server };
}

describe("defineTool — advertised tools/list surface", () => {
  it("maps every ToolSpec field into the real tools/list advertisement", async () => {
    const server = buildBrandedServer();
    const tool = defineTool(
      {
        name: "echo_advertised",
        title: "Echo (advertised)",
        description: "Echoes its query back.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: { query: z.string(), limit: z.number().optional() },
      },
      (_ctx: DomainCtx<unknown, never>) => (args) => toolResult(`echo:${args.query}`),
    );
    tool.register(makeCtx(server));

    const mcp = await connectInMemoryMcp(server);
    try {
      const { tools } = await mcp.client.listTools();
      const advertised = tools.find((t) => t.name === "echo_advertised");
      expect(advertised).toBeDefined();

      // `name` comes from the positional argument (dropped from the config object)...
      expect(advertised!.name).toBe("echo_advertised");
      // ...and every config-mapped spec field survives to the wire.
      expect(advertised!.title).toBe("Echo (advertised)");
      expect(advertised!.description).toBe("Echoes its query back.");
      expect(advertised!.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
      const schema = advertised!.inputSchema as { properties?: Record<string, unknown> };
      expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining(["query", "limit"]));

      // A tool that declares neither outputSchema nor ui advertises neither — the
      // `&&`-elision at the seam must not leak an empty `outputSchema` or `_meta`.
      expect(advertised!.outputSchema).toBeUndefined();
      expect(advertised!._meta).toBeUndefined();
    } finally {
      await mcp.close();
    }
  });

  it("threads a declared outputSchema into the tools/list advertisement", async () => {
    const server = buildBrandedServer();
    const tool = defineTool(
      {
        name: "echo_structured",
        title: "Echo (structured)",
        description: "Echoes its query back with a structured payload.",
        annotations: { readOnlyHint: true },
        inputSchema: { query: z.string() },
        outputSchema: { echoed: z.string() },
      },
      (_ctx: DomainCtx<unknown, never>) => (args) => toolResult(`echo:${args.query}`, { echoed: args.query }),
    );
    tool.register(makeCtx(server));

    const mcp = await connectInMemoryMcp(server);
    try {
      const { tools } = await mcp.client.listTools();
      const advertised = tools.find((t) => t.name === "echo_structured");
      expect(advertised?.outputSchema).toBeDefined();
      const outSchema = advertised!.outputSchema as { properties?: Record<string, unknown> };
      expect(Object.keys(outSchema.properties ?? {})).toContain("echoed");

      // The success-path contract: a tools/call whose result carries
      // `structuredContent` passes the SDK's validateToolOutput and is
      // delivered with both halves intact (the text block and the record).
      const result = await mcp.client.callTool({ name: "echo_structured", arguments: { query: "hi" } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ echoed: "hi" });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]).toMatchObject({ type: "text", text: "echo:hi" });
    } finally {
      await mcp.close();
    }
  });

  it("threads a declared ui resource into the tools/list advertisement _meta", async () => {
    const server = buildBrandedServer();
    const resourceUri = "ui://widget/echo";
    const tool = defineTool(
      {
        name: "echo_widget",
        title: "Echo (widget)",
        description: "Echoes its query back through a widget.",
        annotations: { readOnlyHint: true },
        inputSchema: { query: z.string() },
        ui: { resourceUri },
      },
      (_ctx: DomainCtx<unknown, never>) => (args) => toolResult(`echo:${args.query}`),
    );
    tool.register(makeCtx(server));

    const mcp = await connectInMemoryMcp(server);
    try {
      const { tools } = await mcp.client.listTools();
      const advertised = tools.find((t) => t.name === "echo_widget");
      expect(advertised).toBeDefined();

      // The UI metadata rides into `_meta` as BOTH the preferred nested form (the
      // apps surface reads `_meta.ui.resourceUri`) and the legacy flat key,
      // mirroring what ext-apps' registerAppTool emits — so an older host reading
      // only the flat key still resolves the widget.
      const meta = advertised!._meta as { ui?: { resourceUri?: string }; [k: string]: unknown } | undefined;
      expect(meta?.ui?.resourceUri).toBe(resourceUri);
      expect(meta?.[UI_RESOURCE_URI_META_KEY]).toBe(resourceUri);
    } finally {
      await mcp.close();
    }
  });

  it("routes a tools/call through the registered handler over the transport", async () => {
    const server = buildBrandedServer();
    const tool = defineTool(
      {
        name: "echo_call",
        title: "Echo (call)",
        description: "Echoes its query back.",
        annotations: { readOnlyHint: true },
        inputSchema: { query: z.string() },
      },
      (_ctx: DomainCtx<unknown, never>) => (args) => toolResult(`echo:${args.query}`),
    );
    tool.register(makeCtx(server));

    const mcp = await connectInMemoryMcp(server);
    try {
      const result = await mcp.client.callTool({ name: "echo_call", arguments: { query: "hi" } });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]).toMatchObject({ type: "text", text: "echo:hi" });
    } finally {
      await mcp.close();
    }
  });
});
