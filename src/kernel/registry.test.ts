import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { CacheError } from "../cache/disk-cache.js";
import type { AnySyncResult, SyncError } from "../paprika/sync-types.js";
import type { ErasedModule, Infra, SyncTier } from "./registry.js";

import { makeKernelInfra } from "../../test/support/kernel-harness.js";
import { PaprikaError } from "../paprika/errors.js";
import { buildKernel } from "./registry.js";

/**
 * Drives the kernel's `syncOnce` orchestration in isolation via synthetic modules
 * passed to `buildKernel(infra, modules)`. This covers the dumb-driver contract:
 * reference-before-core ordering, recipe-first within core, reference- and
 * additive-are-best-effort, core-err-aborts-the-cycle (plus the defensive catch
 * for a reconcile that breaks the Result contract by throwing),
 * results-only-after-flush, and end-of-cycle sweep.
 */

const RESULT = (changeType: AnySyncResult["changeType"]): AnySyncResult =>
  ({ changeType, changes: { added: [{ uid: "x" }], updated: [], removedUids: [] } }) as unknown as AnySyncResult;

interface SyncSpec {
  readonly tier: SyncTier;
  reconcile: () => ResultAsync<AnySyncResult | void, SyncError>;
  sweep?: () => number;
}

/** A bare ErasedModule with controlled syncs + flush — no stores, no client calls. */
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
  return makeKernelInfra({ cacheDir: "/tmp/kernel-driver-test-unused" });
}

describe("buildKernel sync driver", () => {
  it("runs the recipe module's core reconcile first, others after (stable)", async () => {
    const order: string[] = [];
    const core = (id: string): SyncSpec => ({
      tier: "core",
      reconcile: () => {
        order.push(id);
        return okAsync(undefined);
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
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(RESULT("recipes")) }]),
      fakeModule("grocery", [{ tier: "core", reconcile: () => okAsync(RESULT("grocery-lists")) }]),
      fakeModule("pantry", [{ tier: "core", reconcile: () => okAsync(undefined) }]),
    ]);
    const results = await kernel.syncOnce();
    expect(results.map((r) => r.changeType).sort()).toEqual(["grocery-lists", "recipes"]);
  });

  it("aborts the cycle and returns [] when a core reconcile errs", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(RESULT("recipes")) }]),
      fakeModule("boom", [{ tier: "core", reconcile: () => errAsync(new PaprikaError("core boom")) }]),
    ]);
    await expect(kernel.syncOnce()).resolves.toEqual([]);
  });

  it("aborts the cycle and returns [] when a reconcile breaks the contract by throwing", async () => {
    // Defensive catch: a reconcile must return a Result, but a bug inside a chain
    // callback rejects the underlying promise — syncOnce still never throws.
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(RESULT("recipes")) }]),
      fakeModule("boom", [
        {
          tier: "core",
          reconcile: () => {
            throw new Error("contract-breaking throw");
          },
        },
      ]),
    ]);
    await expect(kernel.syncOnce()).resolves.toEqual([]);
  });

  it("keeps an additive reconcile best-effort: an err is swallowed, core results survive", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(RESULT("recipes")) }]),
      fakeModule("photo", [{ tier: "additive", reconcile: () => errAsync(new PaprikaError("additive boom")) }]),
    ]);
    const results = await kernel.syncOnce();
    expect(results.map((r) => r.changeType)).toEqual(["recipes"]);
  });

  it("runs reference reconciles before core, then additive", async () => {
    const order: string[] = [];
    const spec = (id: string, tier: SyncTier): SyncSpec => ({
      tier,
      reconcile: () => {
        order.push(id);
        return okAsync(undefined);
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

  it("keeps a reference reconcile best-effort: an err is swallowed, core results survive", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(RESULT("recipes")) }]),
      fakeModule("aisle", [{ tier: "reference", reconcile: () => errAsync(new PaprikaError("reference boom")) }]),
    ]);
    const results = await kernel.syncOnce();
    expect(results.map((r) => r.changeType)).toEqual(["recipes"]);
  });

  it("returns [] when flush errs, even though reconciles produced results", async () => {
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(RESULT("recipes")) }], () =>
        errAsync<void, CacheError>({ context: "flush", message: "flush failed", cause: undefined }),
      ),
    ]);
    await expect(kernel.syncOnce()).resolves.toEqual([]);
  });

  it("runs each contribution's sweep at end-of-cycle", async () => {
    const sweep = vi.fn(() => 0);
    const kernel = await buildKernel(infra(), [
      fakeModule("recipe", [{ tier: "core", reconcile: () => okAsync(undefined), sweep }]),
    ]);
    sweep.mockClear();
    await kernel.syncOnce();
    expect(sweep).toHaveBeenCalledOnce();
  });
});

describe("buildKernel module construction", () => {
  /** A fake module that publishes `api` and records the `deps` its `.build` received. */
  function buildSpyModule(
    id: string,
    dependsOn: ReadonlyArray<string>,
    api: unknown,
    seen: (deps: Record<string, unknown>) => void,
  ): ErasedModule {
    return {
      id,
      dependsOn,
      build: async (_infra: Infra, deps: Record<string, unknown>) => {
        seen(deps);
        return {
          state: {},
          api,
          tools: [],
          resources: undefined,
          syncs: undefined,
          onReady: undefined,
          flush: undefined,
        };
      },
    } as unknown as ErasedModule;
  }

  it("threads each module's declared deps' built contracts into .build", async () => {
    const aisleApi = { kind: "aisle" };
    let pantrySawDeps: Record<string, unknown> = {};
    // Registration order puts the dependent first; topo-sort builds the dep first, so
    // its api is in hand by the time pantry builds.
    await buildKernel(infra(), [
      buildSpyModule("pantry", ["aisle"], { kind: "pantry" }, (deps) => {
        pantrySawDeps = deps;
      }),
      buildSpyModule("aisle", [], aisleApi, () => undefined),
    ]);
    expect(pantrySawDeps).toEqual({ aisle: aisleApi });
  });

  it("passes an empty deps object to a dependency-free module's .build", async () => {
    let sawDeps: Record<string, unknown> = { sentinel: true };
    await buildKernel(infra(), [buildSpyModule("recipe", [], {}, (deps) => (sawDeps = deps))]);
    expect(sawDeps).toEqual({});
  });
});
