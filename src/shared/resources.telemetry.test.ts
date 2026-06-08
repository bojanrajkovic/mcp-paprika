import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { resourceNotFound, tracedResourceRead } from "./resources.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

beforeEach(() => {
  telemetry.spanExporter.reset();
});

describe("tracedResourceRead", () => {
  it("emits a resources/read span with the kind attribute and records the operation histogram", async () => {
    const read = tracedResourceRead("recipes", async (uid: string) => ({ uid }));

    const result = await read("R1");
    expect(result.uid).toBe("R1");

    const [span] = telemetry.spansNamed("resources/read");
    expect(span).toBeDefined();
    expect(span!.attributes["mcp.method.name"]).toBe("resources/read");
    expect(span!.attributes["mcp_paprika.resource.kind"]).toBe("recipes");
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);

    const points = await telemetry.histogramPoints("mcp.server.operation.duration", {
      "mcp.method.name": "resources/read",
      "mcp_paprika.resource.kind": "recipes",
    });
    expect(points).toHaveLength(1);
  });

  it("records resourceNotFound's McpError as an answered protocol error: error.type set, status UNSET, rethrown", async () => {
    const read = tracedResourceRead("menus", async (): Promise<never> => resourceNotFound("Menu not found: M1"));

    await expect(read()).rejects.toBeInstanceOf(McpError);

    const [span] = telemetry.spansNamed("resources/read");
    expect(span!.attributes["error.type"]).toBe("InvalidParams");
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("marks an unexpected escape ERROR with the constructor name and rethrows it unchanged", async () => {
    const boom = new RangeError("bug");
    const read = tracedResourceRead("grocery-lists", async (): Promise<never> => {
      throw boom;
    });

    await expect(read()).rejects.toBe(boom);

    const [span] = telemetry.spansNamed("resources/read");
    expect(span!.attributes["error.type"]).toBe("RangeError");
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
  });
});
