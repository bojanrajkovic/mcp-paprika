import { SpanStatusCode } from "@opentelemetry/api";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";

import type { CacheError } from "../cache/disk-cache.js";
import type { AnySyncResult, SyncError } from "../paprika/sync-types.js";
import type { ErasedModule, Infra, SyncTier } from "./registry.js";

import { makeKernelInfra } from "../../test/support/kernel-harness.js";
import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { PaprikaError } from "../paprika/errors.js";
import { buildKernel } from "./registry.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

const RESULT = (changeType: AnySyncResult["changeType"]): AnySyncResult =>
  ({
    changeType,
    changes: { added: [{ uid: "a" }, { uid: "b" }], updated: [{ uid: "c" }], removedUids: ["d"] },
  }) as unknown as AnySyncResult;

interface SyncSpec {
  readonly tier: SyncTier;
  reconcile: () => ResultAsync<AnySyncResult | void, SyncError>;
  sweep?: () => number;
}

function fakeModule(
  id: string,
  syncs: ReadonlyArray<SyncSpec>,
  flush?: () => ResultAsync<void, CacheError>,
): ErasedModule {
  return {
    id,
    dependsOn: [],
    build: async () => ({ state: {}, api: {}, tools: [], resources: undefined, syncs, onReady: undefined, flush }),
  } as unknown as ErasedModule;
}

function infra(): Infra {
  return makeKernelInfra({ cacheDir: "/tmp/kernel-telemetry-test-unused" });
}

beforeEach(() => {
  telemetry.spanExporter.reset();
});

describe("syncOnce telemetry", () => {
  it("emits a cycle span (outcome ok) parenting per-reconcile spans stamped with tier, domain, and change counts", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(RESULT("recipes")) }]),
      fakeModule("meal", [{ tier: "additive", reconcile: () => okAsync(undefined) }]),
    ]);
    telemetry.spanExporter.reset();
    // Counters are cumulative and the build-time boot cycle already counted
    // this reconcile's changes once — assert the delta, not the absolute.
    const baselineAdded =
      (
        await telemetry.sumPoints("mcp_paprika.sync.changes", {
          "mcp_paprika.sync.entity": "recipes",
          "mcp_paprika.sync.change.kind": "added",
        })
      )[0]?.value ?? 0;

    await kernel.syncOnce();

    const [cycle] = telemetry.spansNamed("paprika.sync_cycle");
    expect(cycle).toBeDefined();
    expect(cycle!.attributes["mcp_paprika.sync.trigger"]).toBe("interval");
    expect(cycle!.attributes["mcp_paprika.sync.outcome"]).toBe("ok");
    expect(cycle!.status.code).toBe(SpanStatusCode.UNSET);

    const [recipeReconcile] = telemetry.spansNamed("paprika.sync.reconcile recipe");
    expect(recipeReconcile!.parentSpanContext?.spanId).toBe(cycle!.spanContext().spanId);
    expect(recipeReconcile!.attributes["mcp_paprika.sync.tier"]).toBe("core");
    expect(recipeReconcile!.attributes["mcp_paprika.sync.entity"]).toBe("recipes");
    expect(recipeReconcile!.attributes["mcp_paprika.sync.added"]).toBe(2);
    expect(recipeReconcile!.attributes["mcp_paprika.sync.updated"]).toBe(1);
    expect(recipeReconcile!.attributes["mcp_paprika.sync.removed"]).toBe(1);

    const [mealReconcile] = telemetry.spansNamed("paprika.sync.reconcile meal");
    expect(mealReconcile!.attributes["mcp_paprika.sync.tier"]).toBe("additive");

    const duration = await telemetry.histogramPoints("mcp_paprika.sync.cycle.duration", {
      "mcp_paprika.sync.outcome": "ok",
    });
    expect(duration.length).toBeGreaterThan(0);

    const added = await telemetry.sumPoints("mcp_paprika.sync.changes", {
      "mcp_paprika.sync.entity": "recipes",
      "mcp_paprika.sync.change.kind": "added",
    });
    expect(added[0]?.value).toBe(baselineAdded + 2);
  });

  it("marks an aborted cycle core_aborted (span ERROR) with error.type on the failing reconcile, and counts no changes", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(RESULT("recipes")) }]),
      fakeModule("boom", [{ tier: "core", reconcile: () => errAsync(new PaprikaError("core boom")) }]),
    ]);
    telemetry.spanExporter.reset();
    const baseline = (await telemetry.sumPoints("mcp_paprika.sync.changes")).reduce((n, p) => n + p.value, 0);

    await kernel.syncOnce();

    const [cycle] = telemetry.spansNamed("paprika.sync_cycle");
    expect(cycle!.attributes["mcp_paprika.sync.outcome"]).toBe("core_aborted");
    expect(cycle!.status.code).toBe(SpanStatusCode.ERROR);

    const [failed] = telemetry.spansNamed("paprika.sync.reconcile boom");
    expect(failed!.attributes["error.type"]).toBe("PaprikaError");
    expect(failed!.status.code).toBe(SpanStatusCode.ERROR);

    // An aborted cycle counts no changes — mirroring its empty results contract.
    const after = (await telemetry.sumPoints("mcp_paprika.sync.changes")).reduce((n, p) => n + p.value, 0);
    expect(after).toBe(baseline);
  });

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

  it("labels the build-time initial cycle trigger=boot", async () => {
    await buildKernel(infra(), [fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(undefined) }])]);

    const bootCycles = telemetry
      .spansNamed("paprika.sync_cycle")
      .filter((s) => s.attributes["mcp_paprika.sync.trigger"] === "boot");
    expect(bootCycles.length).toBe(1);
  });

  it("classes a contract-breaking throw as contract_breach", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("boom", [
        {
          tier: "core",
          reconcile: () => {
            throw new Error("contract-breaking throw");
          },
        },
      ]),
    ]);
    telemetry.spanExporter.reset();

    await kernel.syncOnce();

    const [cycle] = telemetry.spansNamed("paprika.sync_cycle");
    expect(cycle!.attributes["mcp_paprika.sync.outcome"]).toBe("contract_breach");
    expect(cycle!.status.code).toBe(SpanStatusCode.ERROR);
  });
});
