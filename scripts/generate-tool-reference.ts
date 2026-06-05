/**
 * Generates docs/tools/README.md — a single source-of-truth reference for every MCP
 * tool the server registers — by importing the tool modules and reading each tool's
 * `defineTool` spec as DATA. No kernel boot, no McpServer, no SDK internals: a tool
 * is `{ spec, register }`, and the same `spec` that drives registration is what this
 * reads, so the doc can never disagree with the registered surface (ADR-0011). The
 * discovery + rendering live in ./tool-specs.ts, shared with the drift/freshness
 * tests so the generator and its guards see the surface identically.
 *
 * Run: npx tsx scripts/generate-tool-reference.ts  (or: pnpm generate:tool-reference)
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectToolSpecs, renderToolReference } from "./tool-specs.js";

const OUT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "docs", "tools", "README.md");

const specs = await collectToolSpecs();
writeFileSync(OUT, renderToolReference(specs), "utf-8");
process.stdout.write(`Wrote ${OUT} (${specs.length.toString()} tools)\n`);
