import { SpanStatusCode } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";

import type { ErasedModule, Infra } from "./registry.js";

import { makeKernelInfra } from "../../test/support/kernel-harness.js";
import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { buildKernel } from "./registry.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

function infra(): Infra {
  return makeKernelInfra({ cacheDir: "/tmp/kernel-telemetry-test-unused" });
}

beforeEach(() => {
  telemetry.spanExporter.reset();
});

describe("buildKernel boot telemetry", () => {
  it("ends the boot and module spans as errors when a module build rejects (the trace must export)", async () => {
    const boom = new Error("hydration failed");
    const broken = {
      id: "broken",
      dependsOn: [],
      build: async () => {
        throw boom;
      },
    } as unknown as ErasedModule;

    await expect(buildKernel(infra(), [broken])).rejects.toBe(boom);

    // Both spans must be ENDED (an un-ended span never exports, even when the
    // startup-failure path flushes) and classed as errors.
    const [moduleSpan] = telemetry.spansNamed("boot.build_module broken");
    expect(moduleSpan!.status.code).toBe(SpanStatusCode.ERROR);
    expect(moduleSpan!.attributes["error.type"]).toBe("Error");

    const bootSpans = telemetry.spansNamed("mcp_paprika.boot").filter((s) => s.status.code === SpanStatusCode.ERROR);
    expect(bootSpans).toHaveLength(1);
  });
});
