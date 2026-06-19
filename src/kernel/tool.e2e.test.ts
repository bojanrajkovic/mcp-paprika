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
 * from the config object), and the fields the precursor does NOT map
 * (`outputSchema`, `_meta`) must be absent — the forward guards A1 (#306) and C1
 * (#324) each flip when they extend the seam.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { DomainCtx, Infra } from "./registry.js";

import { connectInMemoryMcp } from "../../test/support/in-memory-mcp.js";
import { buildBrandedServer } from "../server/build.js";
import { textResult } from "../shared/tools.js";
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
      (_ctx: DomainCtx<unknown, never>) => (args) => textResult(`echo:${args.query}`),
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

      // Forward guards: the precursor maps neither field. A1 (#306) sets
      // `outputSchema`; C1 (#324) sets `_meta` from `ui`. Each flips its guard.
      expect(advertised!.outputSchema).toBeUndefined();
      expect(advertised!._meta).toBeUndefined();
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
      (_ctx: DomainCtx<unknown, never>) => (args) => textResult(`echo:${args.query}`),
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
