import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { DomainCtx, Infra } from "./registry.js";

import { makePinoCapture, makeTestServer } from "../../test/support/tool-test-utils.js";
import { textResult } from "../shared/tools.js";
import { SILENT_LOG } from "../utils/log.js";
import { defineTool } from "./tool.js";

/**
 * Builds a minimal {@link DomainCtx} for exercising a {@link defineTool} result in
 * isolation: a real stub `server` (so `register` → `callTool` round-trips), a
 * caller-supplied `state`, and a logger (the kernel's wrapper logs through
 * `infra.log`; default silent). `deps` and the rest of `infra` are unused by
 * these tools, so they are cast — this is a unit test of the helper's wiring +
 * typing, not of a domain.
 */
function makeCtx<State>(
  state: State,
  server: ReturnType<typeof makeTestServer>["server"],
  log: Infra["log"] = SILENT_LOG,
): DomainCtx<State, never> {
  return { state, writes: {}, deps: {}, infra: { log } as unknown as Infra, server };
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

  describe("precondition chain (ADR-0015)", () => {
    const spec = {
      name: "gated_tool",
      title: "Gated",
      description: "test",
      annotations: { readOnlyHint: true },
      inputSchema: { q: z.string() },
    };

    it("runs preconditions in order and the body when all pass", async () => {
      const calls: Array<string> = [];
      const tool = defineTool(
        spec,
        [
          function firstGate(_ctx: { readonly state: { ready: boolean } }) {
            calls.push("first");
            return ok(undefined);
          },
          function secondGate(_ctx: { readonly state: { ready: boolean } }) {
            calls.push("second");
            return ok(undefined);
          },
        ],
        (_ctx: DomainCtx<{ ready: boolean }, never>) => (args) => {
          calls.push("body");
          return textResult(`ran:${args.q}`);
        },
      );

      const { server, callTool } = makeTestServer();
      tool.register(makeCtx({ ready: true }, server));

      const out = await callTool("gated_tool", { q: "x" });
      expect(out.content[0]).toMatchObject({ type: "text", text: "ran:x" });
      expect(calls).toEqual(["first", "second", "body"]);
    });

    it("short-circuits on the first err: its CallToolResult IS the response, later gates and body never run", async () => {
      const calls: Array<string> = [];
      const tool = defineTool(
        spec,
        [
          function failingGate(_ctx: { readonly state: unknown }) {
            calls.push("failing");
            return err(textResult("still syncing"));
          },
          function neverReached(_ctx: { readonly state: unknown }) {
            calls.push("never");
            return ok(undefined);
          },
        ],
        (_ctx: DomainCtx<unknown, never>) => () => {
          calls.push("body");
          return textResult("ran");
        },
      );

      const { server, callTool } = makeTestServer();
      tool.register(makeCtx(undefined, server));

      const out = await callTool("gated_tool", { q: "x" });
      expect(out.content[0]).toMatchObject({ type: "text", text: "still syncing" });
      expect(calls).toEqual(["failing"]);
    });

    it("logs 'tool invoked' before the gate and the failing guard's name on a gated call", async () => {
      const { log, records } = makePinoCapture();
      const tool = defineTool(
        spec,
        [
          function coldStartGate(_ctx: { readonly state: unknown }) {
            return err(textResult("not ready"));
          },
        ],
        (_ctx: DomainCtx<unknown, never>) => () => textResult("ran"),
      );

      const { server, callTool } = makeTestServer();
      tool.register(makeCtx(undefined, server, log));
      await callTool("gated_tool", { q: "x" });

      // Invoked is logged even though the gate failed — visibility precedes gating.
      expect(records).toContainEqual(expect.objectContaining({ tool: "gated_tool", msg: "tool invoked" }));
      // Args ride a separate debug record for per-call correlation.
      expect(records).toContainEqual(
        expect.objectContaining({ tool: "gated_tool", args: { q: "x" }, msg: "tool args" }),
      );
      // The gate line is debug (level 20) — expected cold-start state, not an incident.
      expect(records).toContainEqual(
        expect.objectContaining({
          level: 20,
          tool: "gated_tool",
          precondition: "coldStartGate",
          msg: "tool gated by precondition",
        }),
      );
    });

    it("size-bounds oversized arg strings in the debug args record", async () => {
      const { log, records } = makePinoCapture();
      const tool = defineTool(spec, (_ctx: DomainCtx<unknown, never>) => () => textResult("ran"));

      const { server, callTool } = makeTestServer();
      tool.register(makeCtx(undefined, server, log));
      // A payload-sized string (e.g. a base64 image) must not be serialized
      // verbatim into the log record — only a length marker survives.
      await callTool("gated_tool", { q: "x".repeat(10_000) });

      expect(records).toContainEqual(
        expect.objectContaining({ tool: "gated_tool", args: { q: "[10000 chars]" }, msg: "tool args" }),
      );
    });

    it("two-arg form (no preconditions) still logs 'tool invoked' centrally", async () => {
      const { log, records } = makePinoCapture();
      const tool = defineTool(spec, (_ctx: DomainCtx<unknown, never>) => () => textResult("ran"));

      const { server, callTool } = makeTestServer();
      tool.register(makeCtx(undefined, server, log));
      const out = await callTool("gated_tool", { q: "x" });

      expect(out.content[0]).toMatchObject({ type: "text", text: "ran" });
      expect(records).toContainEqual(expect.objectContaining({ tool: "gated_tool", msg: "tool invoked" }));
    });
  });
});
