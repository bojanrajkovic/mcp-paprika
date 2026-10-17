import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, it } from "vitest";

import { collectToolSpecs } from "../../scripts/tool-specs.js";

/**
 * zod 4 publishes every `.int()` with `minimum`/`maximum` of ±(2^53 - 1) unless the
 * field sets its own bounds. Those numbers reach the agent on every `tools/list` and
 * carry no information, so published integers use `integer()` from `src/shared/tools.ts`,
 * which publishes only the bounds a field declares.
 *
 * The schemas go through the same SDK conversion `McpServer` uses for `tools/list`.
 */
const SAFE = Number.MAX_SAFE_INTEGER;

function implicitBounds(node: unknown, path: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => implicitBounds(child, `${path}[${i.toString()}]`, out));
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (record["minimum"] === -SAFE || record["maximum"] === SAFE) out.push(path);
  for (const [key, child] of Object.entries(record)) implicitBounds(child, `${path}.${key}`, out);
}

describe("published tool schemas carry no implicit integer bounds", () => {
  it("every integer field publishes only its declared bounds", async () => {
    const offenders: string[] = [];
    for (const spec of await collectToolSpecs()) {
      const schemas = [
        ["inputSchema", spec.inputSchema, "input"],
        ["outputSchema", spec.outputSchema, "output"],
      ] as const;
      for (const [label, schema, pipeStrategy] of schemas) {
        const obj = schema === undefined ? undefined : normalizeObjectSchema(schema);
        if (obj === undefined) continue;
        implicitBounds(
          toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy }),
          `${spec.name}.${label}`,
          offenders,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
