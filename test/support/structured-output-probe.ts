import { z } from "zod";
import type { ZodTypeAny } from "zod";

import type { DomainCtx, Infra } from "../../src/kernel/registry.js";

import { defineTool } from "../../src/kernel/tool.js";
import { buildBrandedServer } from "../../src/server/build.js";
import { toolResult } from "../../src/shared/tools.js";
import { SILENT_LOG } from "../../src/utils/log.js";
import { connectInMemoryMcp } from "./in-memory-mcp.js";

/**
 * Register a synthetic tool that declares `outputSchema` and returns the fixed
 * `structured` payload, then call it over the real in-memory SDK transport — so the
 * SDK advertises the schema (`toJsonSchema`) and validates the result against it.
 *
 * This is the shared harness behind the R1 structured-output e2es (ADR-0019): they
 * confirm a *production* `outputSchema` is SDK-accepted for a representative payload,
 * coverage the `makeTestServer` unit stub can't reach (it discards the `registerTool`
 * config and never runs `validateToolOutput`). A non-error result means the SDK
 * accepted the schema and the payload; an `isError` result is the SDK's rejection.
 */
export async function callStructuredProbe(outputSchema: ZodTypeAny, structured: Record<string, unknown>) {
  const server = buildBrandedServer();
  const tool = defineTool(
    {
      name: "structured_output_probe",
      title: "Structured output probe",
      description: "Returns a fixed structured payload to validate a production outputSchema through the SDK.",
      annotations: { readOnlyHint: true },
      inputSchema: { unused: z.string().optional() },
      outputSchema,
    },
    (_ctx: DomainCtx<unknown, never>) => () => toolResult("ok", structured),
  );
  tool.register({ state: undefined, writes: {}, deps: {}, infra: { log: SILENT_LOG } as unknown as Infra, server });
  const mcp = await connectInMemoryMcp(server);
  try {
    return await mcp.client.callTool({ name: "structured_output_probe", arguments: {} });
  } finally {
    await mcp.close();
  }
}
