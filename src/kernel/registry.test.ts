import { describe, expect, it, vi } from "vitest";

import type { AnySyncResult } from "../paprika/sync-types.js";
import type { ErasedModule, Infra, SyncTier } from "./registry.js";

import { makeKernelInfra } from "../../test/support/kernel-harness.js";
import { buildKernel } from "./registry.js";

/**
 * Drives the kernel's `syncOnce` orchestration in isolation via synthetic modules
 * passed to `buildKernel(infra, modules)`. This covers the dumb-driver contract:
 * reference-before-core ordering, recipe-first within core, reference- and
 * additive-are-best-effort, core-aborts-the-cycle, results-only-after-flush, and
 * end-of-cycle sweep.
 */

const RESULT = (changeType: AnySyncResult["changeType"]): AnySyncResult =>
  ({ changeType, changes: { added: [{ uid: "x" }], updated: [], removedUids: [] } }) as unknown as AnySyncResult;

interface SyncSpec {
  readonly tier: SyncTier;
  reconcile: () => Promise<AnySyncResult | void>;
  sweep?: () => number;
}

/** A bare ErasedModule with controlled syncs + flush — no stores, no client calls. */
function fakeModule(id: string, syncs: ReadonlyArray<SyncSpec>, flush?: () => Promise<void>): ErasedModule {
  return {
    id,
    dependsOn: [],
    build: async () => ({ state: {}, api: {}, tools: [], resources: undefined, syncs, onReady: undefined, flush }),
  } as unknown as ErasedModule;
}

function infra(): Infra {
  return makeKernelInfra({ cacheDir: "/tmp/kernel-driver-test-unused" });
}

describe("buildKernel sync driver", () => {
  it("runs the recipe module's core reconcile first, others after (stable)", async () => {
    const order: string[] = [];
    const core = (id: string): SyncSpec => ({
      tier: "core",
      reconcile: async () => {
        order.push(id);
      },
    });
    // Registration order puts recipe in the middle; the driver must hoist it to front.
    const kernel = await buildKernel(infra(), [
      fakeModule("aaa", [core("aaa")]),
      fakeModule("recipe", [core("recipe")]),
      fakeModule("zzz", [core("zzz")]),
    ]);
    order.length = 0;
    await kernel.syncOnce();
    expect(order[0]).toBe("recipe");
    expect(order).toEqual(["recipe", "aaa", "zzz"]);
  });

  it("returns the completed cycle's results (one per emitting reconcile)", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: async () => RESULT("recipes") }]),
      fakeModule("grocery", [{ tier: "core", reconcile: async () => RESULT("grocery-lists") }]),
      fakeModule("pantry", [{ tier: "core", reconcile: async () => undefined }]),
    ]);
    const results = await kernel.syncOnce();
    expect(results.map((r) => r.changeType).sort()).toEqual(["grocery-lists", "recipes"]);
  });

  it("aborts the cycle and returns [] when a core reconcile throws", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: async () => RESULT("recipes") }]),
      fakeModule("boom", [
        {
          tier: "core",
          reconcile: async () => {
            throw new Error("core boom");
          },
        },
      ]),
    ]);
    await expect(kernel.syncOnce()).resolves.toEqual([]);
  });

  it("keeps an additive reconcile best-effort: a throw is swallowed, core results survive", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: async () => RESULT("recipes") }]),
      fakeModule("photo", [
        {
          tier: "additive",
          reconcile: async () => {
            throw new Error("additive boom");
          },
        },
      ]),
    ]);
    const results = await kernel.syncOnce();
    expect(results.map((r) => r.changeType)).toEqual(["recipes"]);
  });

  it("runs reference reconciles before core, then additive", async () => {
    const order: string[] = [];
    const spec = (id: string, tier: SyncTier): SyncSpec => ({
      tier,
      reconcile: async () => {
        order.push(id);
      },
    });
    // Registration order puts the reference catalog LAST; the tier must still run it first.
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [spec("recipe", "core")]),
      fakeModule("meals", [spec("meals", "additive")]),
      fakeModule("aisle", [spec("aisle", "reference")]),
    ]);
    order.length = 0;
    await kernel.syncOnce();
    expect(order).toEqual(["aisle", "recipe", "meals"]);
  });

  it("keeps a reference reconcile best-effort: a throw is swallowed, core results survive", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: async () => RESULT("recipes") }]),
      fakeModule("aisle", [
        {
          tier: "reference",
          reconcile: async () => {
            throw new Error("reference boom");
          },
        },
      ]),
    ]);
    const results = await kernel.syncOnce();
    expect(results.map((r) => r.changeType)).toEqual(["recipes"]);
  });

  it("returns [] when flush rejects, even though reconciles produced results", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: async () => RESULT("recipes") }], async () => {
        throw new Error("flush failed");
      }),
    ]);
    await expect(kernel.syncOnce()).resolves.toEqual([]);
  });

  it("runs each contribution's sweep at end-of-cycle", async () => {
    const sweep = vi.fn(() => 0);
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: async () => undefined, sweep }]),
    ]);
    sweep.mockClear();
    await kernel.syncOnce();
    expect(sweep).toHaveBeenCalledOnce();
  });
});
