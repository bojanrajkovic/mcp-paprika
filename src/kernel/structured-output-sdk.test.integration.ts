import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PaprikaConfig } from "../utils/config.js";
import type { Infra } from "./registry.js";

import { collectToolSpecs } from "../../scripts/tool-specs.js";
import { useTempDir } from "../../test/support/disk-caches.js";
import { connectInMemoryMcp } from "../../test/support/in-memory-mcp.js";
import { makeStubNotifier } from "../../test/support/tool-test-utils.js";
import { GeneratedImageStore } from "../features/generated-image-store.js";
import { PaprikaClient } from "../paprika/client.js";
import { buildBrandedServer } from "../server/build.js";
import { createIndexEvents } from "../server/index-events.js";
import { SILENT_LOG } from "../utils/log.js";
import { buildKernel } from "./registry.js";
// Side-effect: register every kernel module so buildKernel's default module list is populated.
import "./modules.generated.js";

/**
 * The GENERAL structured-output × SDK conformance gate (ADR-0019, #357).
 *
 * The per-domain `*-structured-output.e2e.test.ts` files validate a few schemas with
 * representative (rich) payloads; this gate covers the whole registered surface at
 * once and auto-extends to every future adopter (A2 #313, B1 #321, …) with no per-batch
 * bookkeeping. It builds the REAL kernel (`buildKernel` + `registerAll`, the production
 * composition path) against MSW-backed empty endpoints, reads the advertised surface
 * over the in-memory transport, and asserts:
 *   (A) every tool that declares an `outputSchema` advertises it in `tools/list` —
 *       proving the SDK's `toJsonSchema` serialization succeeds for every real schema;
 *   (B) a representative set of schema-bearing reads, called after the empty initial
 *       sync, return a non-error result carrying `structuredContent` — proving the
 *       SDK's `validateToolOutput` accepts the real (empty-success) output end-to-end.
 */

const API_BASE = "https://paprikaapp.com/api/v2/sync";

const server = setupServer();
const tmp = useTempDir("paprika-structured-conformance-");

beforeAll(() => {
  server.listen();
});
afterAll(() => {
  server.close();
});
beforeEach(async () => {
  await tmp.setup();
  server.resetHandlers();
  // Every entity endpoint returns empty, so the initial sync marks each store synced
  // (so the read tools' cold-start guards pass) with no data.
  for (const path of [
    "recipes",
    "categories",
    "groceryaisles",
    "pantry",
    "grocerylists",
    "groceries",
    "groceryingredients",
    "mealtypes",
    "meals",
    "menus",
    "menuitems",
    "photos",
  ]) {
    server.use(http.get(`${API_BASE}/${path}/`, () => HttpResponse.json({ result: [] })));
  }
});
afterEach(async () => {
  await tmp.teardown();
});

const KERNEL_TEST_CONFIG = {
  transport: "stdio",
  sync: { enabled: true, pendingWriteTtl: 60_000, interval: 60_000, recipeFetchConcurrency: 4 },
} as unknown as PaprikaConfig;

async function buildRegisteredMcp() {
  const infra: Infra = {
    client: new PaprikaClient("test@example.com", "password"),
    cacheDir: tmp.dir(),
    notifier: makeStubNotifier().notifier,
    log: SILENT_LOG,
    config: KERNEL_TEST_CONFIG,
    indexEvents: createIndexEvents(SILENT_LOG),
    generatedImageStore: new GeneratedImageStore(),
  };
  const kernel = await buildKernel(infra);
  const mcpServer = buildBrandedServer();
  kernel.registerAll(mcpServer);
  return connectInMemoryMcp(mcpServer);
}

describe("structured output: every schema validates through the SDK (full surface, #357)", () => {
  it("every schema-bearing tool advertises its outputSchema in tools/list (toJsonSchema serializes)", async () => {
    const schemaBearing = (await collectToolSpecs())
      .filter((s) => s.outputSchema !== undefined)
      .map((s) => s.name)
      .sort();
    expect(schemaBearing.length).toBeGreaterThan(0); // sanity: the rollout is underway

    const mcp = await buildRegisteredMcp();
    try {
      const { tools } = await mcp.client.listTools();
      const advertised = new Map(tools.map((t) => [t.name, t]));
      const missing = schemaBearing.filter((name) => advertised.get(name)?.outputSchema === undefined);
      // A name here means `toJsonSchema` failed to serialize that tool's outputSchema —
      // the SDK would then reject every call to it at runtime, untested by the unit path.
      expect(missing).toEqual([]);
    } finally {
      await mcp.close();
    }
  });

  it("representative reads validate their real empty-success payload through validateToolOutput", async () => {
    const mcp = await buildRegisteredMcp();
    try {
      // Span the schema shapes: paginated list, plain `{ items }` catalog, the meal row.
      // Each is synced-but-empty, so it returns its empty-success structuredContent, which
      // the SDK validates against the declared schema (non-error means it accepted it).
      for (const name of ["list_recipes", "list_aisles", "list_pantry_items", "read_meal_plan"]) {
        const result = await mcp.client.callTool({ name, arguments: {} });
        expect(result.isError, `${name} was rejected by the SDK`).toBeFalsy();
        expect(result.structuredContent, `${name} carried no structuredContent`).toBeDefined();
      }
    } finally {
      await mcp.close();
    }
  });
});
