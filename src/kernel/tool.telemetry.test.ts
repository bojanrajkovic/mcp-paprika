import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { DomainCtx, Infra } from "./registry.js";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { makeTestServer } from "../../test/support/tool-test-utils.js";
import { textResult } from "../shared/tools.js";
import { SILENT_LOG } from "../utils/log.js";
import { defineTool, type ToolPrecondition } from "./tool.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

function makeCtx<State>(state: State, server: ReturnType<typeof makeTestServer>["server"]): DomainCtx<State, never> {
  return { state, writes: {}, deps: {}, infra: { log: SILENT_LOG } as unknown as Infra, server };
}

function spec(name: string): Parameters<typeof defineTool>[0] {
  return {
    name,
    title: name,
    description: "telemetry test tool",
    annotations: { readOnlyHint: true },
    inputSchema: { q: z.string().optional() },
  };
}

beforeEach(() => {
  telemetry.spanExporter.reset();
});

describe("defineTool telemetry", () => {
  it("emits a tools/call span with the MCP + GenAI attributes and records the operation histogram", async () => {
    const tool = defineTool(spec("t_ok"), (_ctx: DomainCtx<unknown, never>) => async () => textResult("fine"));
    const { server, callTool } = makeTestServer();
    tool.register(makeCtx(undefined, server));

    await callTool("t_ok", {});

    const [span] = telemetry.spansNamed("tools/call t_ok");
    expect(span).toBeDefined();
    expect(span!.attributes["mcp.method.name"]).toBe("tools/call");
    expect(span!.attributes["gen_ai.operation.name"]).toBe("execute_tool");
    expect(span!.attributes["gen_ai.tool.name"]).toBe("t_ok");
    expect(span!.attributes["error.type"]).toBeUndefined();
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);

    const points = await telemetry.histogramPoints("mcp.server.operation.duration", { "gen_ai.tool.name": "t_ok" });
    expect(points).toHaveLength(1);
    expect(points[0]!.value.count).toBe(1);
    expect(points[0]!.attributes["error.type"]).toBeUndefined();
  });

  it("classes an isError result as tool_error with span status ERROR", async () => {
    const failure: CallToolResult = { content: [{ type: "text", text: "boom" }], isError: true };
    const tool = defineTool(spec("t_err"), (_ctx: DomainCtx<unknown, never>) => async () => failure);
    const { server, callTool } = makeTestServer();
    tool.register(makeCtx(undefined, server));

    await callTool("t_err", {});

    const [span] = telemetry.spansNamed("tools/call t_err");
    expect(span!.attributes["error.type"]).toBe("tool_error");
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);

    const points = await telemetry.histogramPoints("mcp.server.operation.duration", {
      "gen_ai.tool.name": "t_err",
      "error.type": "tool_error",
    });
    expect(points).toHaveLength(1);
  });

  it("classes a gated call as precondition_gated, names the guard, and keeps status UNSET", async () => {
    const gateResult: CallToolResult = { content: [{ type: "text", text: "syncing" }], isError: true };
    const coldStartGuard: ToolPrecondition<DomainCtx<unknown, never>> = function coldStartGuard() {
      return err(gateResult);
    };
    const tool = defineTool(
      spec("t_gated"),
      [coldStartGuard],
      (_ctx: DomainCtx<unknown, never>) => async () => textResult("never reached"),
    );
    const { server, callTool } = makeTestServer();
    tool.register(makeCtx(undefined, server));

    const out = await callTool("t_gated", {});
    expect(out).toBe(gateResult);

    const [span] = telemetry.spansNamed("tools/call t_gated");
    expect(span!.attributes["error.type"]).toBe("precondition_gated");
    expect(span!.attributes["mcp_paprika.tool.gated_by"]).toBe("coldStartGuard");
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("parents spans started inside the body under the tool span (context propagation)", async () => {
    const tool = defineTool(spec("t_parent"), (_ctx: DomainCtx<unknown, never>) => async () => {
      const child = trace.getTracer("body").startSpan("body.work");
      child.end();
      return textResult("done");
    });
    const { server, callTool } = makeTestServer();
    tool.register(makeCtx(undefined, server));

    await callTool("t_parent", {});

    const [parent] = telemetry.spansNamed("tools/call t_parent");
    const [child] = telemetry.spansNamed("body.work");
    expect(child!.parentSpanContext?.spanId).toBe(parent!.spanContext().spanId);
  });

  it("a passing precondition leaves no gate attributes behind", async () => {
    const openGuard: ToolPrecondition<DomainCtx<unknown, never>> = function openGuard() {
      return ok(undefined);
    };
    const tool = defineTool(
      spec("t_open"),
      [openGuard],
      (_ctx: DomainCtx<unknown, never>) => async () => textResult("through"),
    );
    const { server, callTool } = makeTestServer();
    tool.register(makeCtx(undefined, server));

    await callTool("t_open", {});

    const [span] = telemetry.spansNamed("tools/call t_open");
    expect(span!.attributes["mcp_paprika.tool.gated_by"]).toBeUndefined();
    expect(span!.attributes["error.type"]).toBeUndefined();
  });
});
