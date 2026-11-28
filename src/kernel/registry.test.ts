import { okAsync, ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { ErasedModule, Infra } from "./registry.js";

import { makeKernelInfra } from "../../test/support/kernel-harness.js";
import { buildKernel } from "./registry.js";

/**
 * Drives `buildKernel`'s construction and boot phases via synthetic modules: the
 * dependency-ordered `.build` with its deps, and the initial sync gating the
 * `onIndexReady` hook. The sync driver's own contract is covered in `sync.test.ts`.
 */

function infra(): Infra {
  return makeKernelInfra({ cacheDir: "/tmp/kernel-driver-test-unused" });
}

describe("buildKernel boot ordering", () => {
  it("runs onIndexReady exactly once, after the initial sync, and not on later cycles", async () => {
    const order: string[] = [];
    const indexed = {
      id: "discover",
      dependsOn: [],
      build: async () => ({
        state: {},
        api: {},
        tools: [],
        resources: undefined,
        syncs: [
          {
            tier: "core",
            reconcile: () => {
              order.push("sync");
              return okAsync(undefined);
            },
          },
        ],
        onIndexReady: async () => {
          order.push("index");
        },
        flush: undefined,
      }),
    } as unknown as ErasedModule;

    const kernel = await buildKernel(infra(), [indexed]);
    expect(order).toEqual(["sync", "index"]);

    await kernel.syncOnce();
    expect(order).toEqual(["sync", "index", "sync"]);
  });
});

describe("buildKernel boot deadline", () => {
  /** A module whose sync waits on `gate` before it resolves. */
  function gatedModule(gate: Promise<void>, order: string[]): ErasedModule {
    return {
      id: "slow",
      dependsOn: [],
      build: async () => ({
        state: {},
        api: {},
        tools: [],
        resources: undefined,
        syncs: [
          {
            tier: "core",
            reconcile: () => {
              order.push("sync:start");
              return ResultAsync.fromSafePromise(gate.then(() => void order.push("sync:end")));
            },
          },
        ],
        onIndexReady: async () => {
          order.push("index");
        },
        flush: undefined,
      }),
    } as unknown as ErasedModule;
  }

  function infraWithBootTimeout(ms: number): Infra {
    const base = infra();
    return { ...base, config: { ...base.config, sync: { ...base.config.sync, bootTimeout: ms } } };
  }

  it("returns once sync.bootTimeout passes and finishes the boot cycle in the background", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const kernel = await buildKernel(infraWithBootTimeout(20), [gatedModule(gate, order)]);
    expect(order).toEqual(["sync:start"]);

    release();
    await kernel.syncOnce();
    expect(order).toEqual(["sync:start", "sync:end", "index", "sync:start", "sync:end"]);
  });

  it("serializes cycles so a later cycle waits for the background boot cycle", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const kernel = await buildKernel(infraWithBootTimeout(0), [gatedModule(gate, order)]);
    const next = kernel.syncOnce();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The second cycle has not started while the boot cycle is still gated.
    expect(order).toEqual(["sync:start"]);

    release();
    await next;
    expect(order.filter((step) => step === "sync:start")).toHaveLength(2);
    expect(order.indexOf("sync:end")).toBeLessThan(order.lastIndexOf("sync:start"));
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
          onIndexReady: undefined,
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
