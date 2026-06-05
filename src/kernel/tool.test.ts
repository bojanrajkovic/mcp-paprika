import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { DomainCtx, Infra } from "./registry.js";

import { makeTestServer } from "../../test/support/tool-test-utils.js";
import { textResult } from "../shared/tools.js";
import { defineTool } from "./tool.js";

/**
 * Builds a minimal {@link DomainCtx} for exercising a {@link defineTool} result in
 * isolation: a real stub `server` (so `register` → `callTool` round-trips) and a
 * caller-supplied `state`. `infra`/`deps` are unused by these tools, so they are
 * cast — this is a unit test of the helper's wiring + typing, not of a domain.
 */
function makeCtx<Self>(state: Self, server: ReturnType<typeof makeTestServer>["server"]): DomainCtx<Self, never> {
  return { state, deps: {}, infra: {} as unknown as Infra, server };
}

describe("defineTool", () => {
  it("registers under spec.name and routes args + ctx.state to the handler (raw shape)", async () => {
    const tool = defineTool(
      {
        name: "echo_raw",
        title: "Echo (raw shape)",
        description: "test",
        annotations: { readOnlyHint: true },
        inputSchema: { query: z.string(), limit: z.number().optional() },
      },
      (ctx: DomainCtx<{ prefix: string }, never>) =>
        // Inference proof: `args` is typed from the raw shape. Wrong inference
        // (e.g. `any`) would let these annotated locals slip; correct inference
        // requires `query: string` and `limit?: number`.
        (args) => {
          const query: string = args.query;
          const limit: number | undefined = args.limit;
          return textResult(`${ctx.state.prefix}:${query}:${String(limit)}`);
        },
    );

    const { server, callTool } = makeTestServer();
    tool.register(makeCtx({ prefix: "P" }, server));

    expect(tool.spec.name).toBe("echo_raw");
    const out = await callTool("echo_raw", { query: "hi", limit: 3 });
    expect(out.content[0]).toMatchObject({ type: "text", text: "P:hi:3" });
  });

  it("infers args from a whole .strict() ZodObject (the write-schema form)", async () => {
    const schema = z.object({ uid: z.string(), count: z.number() }).strict();
    const tool = defineTool(
      {
        name: "echo_object",
        title: "Echo (zod object)",
        description: "test",
        annotations: { readOnlyHint: false, destructiveHint: true },
        inputSchema: schema,
      },
      (_ctx: DomainCtx<unknown, never>) => (args) => {
        const uid: string = args.uid;
        const count: number = args.count;
        return textResult(`${uid}x${String(count)}`);
      },
    );

    const { server, callTool } = makeTestServer();
    tool.register(makeCtx(undefined, server));

    const out = await callTool("echo_object", { uid: "U1", count: 2 });
    expect(out.content[0]).toMatchObject({ type: "text", text: "U1x2" });
  });

  it("accepts an empty input schema (no-arg tools)", async () => {
    const tool = defineTool(
      {
        name: "ping",
        title: "Ping",
        description: "test",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: {},
      },
      (_ctx: DomainCtx<unknown, never>) => () => textResult("pong"),
    );

    const { server, callTool } = makeTestServer();
    tool.register(makeCtx(undefined, server));

    const out = await callTool("ping", {});
    expect(out.content[0]).toMatchObject({ type: "text", text: "pong" });
  });

  it("accepts a raw shape extracted via .shape", async () => {
    const schema = z.object({ name: z.string() });
    const tool = defineTool(
      {
        name: "echo_shape",
        title: "Echo (.shape)",
        description: "test",
        annotations: { readOnlyHint: true },
        inputSchema: schema.shape,
      },
      (_ctx: DomainCtx<unknown, never>) => (args) => textResult(args.name),
    );

    const { server, callTool } = makeTestServer();
    tool.register(makeCtx(undefined, server));

    const out = await callTool("echo_shape", { name: "Soup" });
    expect(out.content[0]).toMatchObject({ type: "text", text: "Soup" });
  });
});
