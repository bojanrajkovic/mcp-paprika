import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { vi } from "vitest";

import type { GroceryState } from "../../src/domains/grocery/module.js";
import type { MenuState } from "../../src/domains/menu/module.js";
import type { RecipeState } from "../../src/domains/recipe/module.js";
import type { DomainId, ErasedModule, Infra } from "../../src/kernel/registry.js";
import type { PaprikaClient } from "../../src/paprika/client.js";
import type { Notifier } from "../../src/server/notifier.js";
import type { PaprikaConfig } from "../../src/utils/config.js";
import type { SeedData } from "../fixtures/seed.js";

import { GeneratedImageStore } from "../../src/features/generated-image-store.js";
import { registeredModules } from "../../src/kernel/registry.js";
import { createIndexEvents } from "../../src/server/index-events.js";
import { SILENT_LOG } from "../../src/utils/log.js";
import { getCacheDir } from "../../src/utils/xdg.js";
import { getText, makeStubNotifier, makeTestServer } from "./tool-test-utils.js";
import { useXdgIsolation } from "./xdg-isolation.js";
// Side-effect: every domain/feature module self-registers, so `registeredModules()`
// is populated and the harness can resolve any module + its deps by id.
import "../../src/kernel/modules.generated.js";

// Re-export the declarative seed payload — the same shape the legacy `seed` took, so a
// ported test's `kh.seed({ recipes: [...] })` payload is unchanged.
export type { SeedData } from "../fixtures/seed.js";

/** A built module: the kernel's own erased build result (state/api/tools/resources/...). */
type Built = Awaited<ReturnType<ErasedModule["build"]>>;

function makeTestConfig(): PaprikaConfig {
  // The modules read only `sync.{enabled,pendingWriteTtl}` (store pending-write TTL) and
  // `features` (the discover/photo-gen gates). A cast keeps the test free of the full
  // schema — the historical test convention (cf. makeAppContext's `{} as …` casts).
  return {
    transport: "stdio",
    sync: { enabled: true, pendingWriteTtl: 60_000, interval: 60_000, recipeFetchConcurrency: 4 },
    // `features` omitted → `config.features?.…` is undefined → embeddings + imageGen off.
  } as unknown as PaprikaConfig;
}

/**
 * A mock {@link PaprikaClient} whose every method is a memoized `vi.fn()`: accessing
 * `client.saveRecipe` lazily creates (and caches) a spy, so a write-tool test configures
 * and asserts the live mock post-setup — `vi.mocked(kh.client().saveRecipe).mockResolvedValue(…)`
 * then `expect(kh.client().saveRecipe).toHaveBeenCalledOnce()` — with no per-test injection.
 * Every auto-stub resolves to `undefined` (a real promise — the commit chokepoints
 * feed `notifySync()` through `ResultAsync.fromPromise`, which needs a thenable);
 * methods whose RETURN a tool consumes (e.g. `saveRecipe`) must be given a value by
 * the test. `overrides` win over a stub.
 */
function makeMockClient(overrides: Partial<Record<keyof PaprikaClient, unknown>> = {}): PaprikaClient {
  const target: Record<string, unknown> = { ...overrides };
  const stubs = new Map<string, ReturnType<typeof vi.fn>>();
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in t) return t[prop];
      let fn = stubs.get(prop);
      if (fn === undefined) {
        fn = vi.fn().mockResolvedValue(undefined);
        stubs.set(prop, fn);
      }
      return fn;
    },
  }) as unknown as PaprikaClient;
}

export interface MakeKernelInfraOptions {
  readonly cacheDir: string;
  /** A stub Notifier (defaults to a fresh `makeStubNotifier()`); pass one to keep its spies. */
  readonly notifier?: Notifier;
  /** Client-method overrides; any method not overridden auto-stubs to a memoized `vi.fn()`. */
  readonly client?: Partial<Record<keyof PaprikaClient, unknown>>;
  readonly config?: PaprikaConfig;
}

/**
 * A minimal test {@link Infra}: a stub notifier, silent log, a cache dir each module's
 * `DiskCache` opens under, features OFF, and an auto-stubbing mock `client` (see
 * {@link makeMockClient}). Mirrors `makeAppContext`'s "every field defaulted" contract.
 */
export function makeKernelInfra(opts: MakeKernelInfraOptions): Infra {
  const client = makeMockClient(opts.client);
  return {
    client,
    cacheDir: opts.cacheDir,
    notifier: opts.notifier ?? makeStubNotifier().notifier,
    log: SILENT_LOG,
    config: opts.config ?? makeTestConfig(),
    indexEvents: createIndexEvents(SILENT_LOG),
    generatedImageStore: new GeneratedImageStore(),
  };
}

/** Resolve `rootId` + its transitive `dependsOn` closure, deps before dependents. */
function closure(rootId: string): ReadonlyArray<ErasedModule> {
  const byId = new Map(registeredModules().map((m) => [m.id, m] as const));
  const order: Array<ErasedModule> = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const m = byId.get(id);
    if (m === undefined) throw new Error(`kernel-harness: no registered module "${id}"`);
    for (const dep of m.dependsOn) visit(dep);
    order.push(m);
  };
  visit(rootId);
  return order;
}

interface StoreLike {
  load(items: ReadonlyArray<never>): void;
}

/** Route a declarative payload to the built modules' (private) stores — kernel analogue of `seed`. */
function seedBuilt(built: ReadonlyMap<string, Built>, data: SeedData): void {
  const recipe = built.get("recipe");
  if (recipe !== undefined) {
    const state = recipe.state as RecipeState;
    if (data.recipes) state.recipe.store.load(data.recipes);
    if (data.categories) state.category.store.load(data.categories);
    if (data.photos) state.photo.store.load(data.photos);
  }
  const single = (id: string, items: ReadonlyArray<never> | undefined): void => {
    const b = built.get(id);
    if (b !== undefined && items) (b.state as { store: StoreLike }).store.load(items);
  };
  single("pantry", data.pantry as ReadonlyArray<never> | undefined);
  single("aisle", data.aisles as ReadonlyArray<never> | undefined);
  single("meal", data.meals as ReadonlyArray<never> | undefined);
  single("meal-type", data.mealTypes as ReadonlyArray<never> | undefined);
  const grocery = built.get("grocery");
  if (grocery !== undefined) {
    const state = grocery.state as GroceryState;
    if (data.groceryLists) state.lists.store.load(data.groceryLists);
    if (data.groceryItems) state.items.store.load(data.groceryItems);
    if (data.groceryIngredients) state.ingredients.store.load(data.groceryIngredients);
  }
  const menu = built.get("menu");
  if (menu !== undefined) {
    const state = menu.state as MenuState;
    if (data.menus) state.menus.store.load(data.menus);
    if (data.menuItems) state.items.store.load(data.menuItems);
  }
}

interface LiveHarness {
  readonly server: McpServer;
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  readonly callResourceList: (name: string) => Promise<unknown>;
  readonly callResource: (name: string, uid: string, uri?: string) => Promise<unknown>;
  readonly built: ReadonlyMap<string, Built>;
  readonly rootState: unknown;
  readonly rootWrites: unknown;
  readonly infra: Infra;
  readonly notifier: Notifier;
  readonly resourceListChanged: ReturnType<typeof vi.fn>;
}

export interface UseKernelHarnessOptions {
  readonly client?: Partial<Record<keyof PaprikaClient, unknown>>;
  readonly config?: PaprikaConfig;
}

/**
 * The kernel analogue of `makeTestServer` + `makeCtx` + `seed`, in the composable
 * `useFoo` style (like {@link useXdgIsolation}): create it once at describe scope, wire
 * `setup`/`teardown` into `beforeEach`/`afterEach`, then use the action + accessor methods
 * inside each test. `setup()` redirects `XDG_CACHE_HOME` into a fresh temp dir (so every
 * module's `DiskCache` is isolated), builds the module under test plus its declared-
 * dependency closure against a test {@link Infra}, registers ONLY the root module's
 * tools/resources on a stub server, and wires the root's `ctx.deps` from the built deps'
 * contracts (so a tool reaches its deps' real APIs exactly as in production). `teardown()`
 * delegates to {@link useXdgIsolation}, which restores the env and removes the temp dir.
 *
 * ```ts
 * const kh = useKernelHarness("recipe");
 * beforeEach(kh.setup);
 * afterEach(kh.teardown);
 * it("reads a recipe", async () => {
 *   kh.seed({ recipes: [makeRecipe({ name: "Soup" })] });
 *   expect(await kh.callToolText("read_recipe", { lookup: { title: "Soup" } })).toContain("# Soup");
 * });
 * ```
 *
 * Tests run sequentially per file, so the process-wide XDG mutation is safe — do NOT use
 * `it.concurrent` with this harness.
 */
export interface KernelHarness<State = unknown, Writes = unknown> {
  readonly setup: () => Promise<void>;
  readonly teardown: () => Promise<void>;
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  /** `callTool` then the text of the first content block — the common read-assertion shorthand. */
  readonly callToolText: (name: string, args: Record<string, unknown>) => Promise<string>;
  readonly callResourceList: (name: string) => Promise<unknown>;
  readonly callResource: (name: string, uid: string, uri?: string) => Promise<unknown>;
  readonly seed: (data: SeedData) => void;
  /** The root module's `state`, typed via the `State` generic (e.g. `useKernelHarness<RecipeState>("recipe")`). */
  readonly state: () => State;
  /** Any built module's `state`, keyed by id (root + transitive deps); cast at the call site (cross-module). */
  readonly stateOf: (id: string) => unknown;
  /** The root module's write chokepoints (`ctx.writes`), typed via the `Writes` generic. */
  readonly writes: () => Writes;
  readonly infra: () => Infra;
  readonly notifier: () => Notifier;
  /** The resource-list-changed spy on the stub notifier. */
  readonly resourceListChanged: () => ReturnType<typeof vi.fn>;
  readonly client: () => PaprikaClient;
}

export function useKernelHarness<State = unknown, Writes = unknown>(
  rootId: DomainId,
  opts: UseKernelHarnessOptions = {},
): KernelHarness<State, Writes> {
  const xdg = useXdgIsolation("mcp-paprika-kernel");
  let state: LiveHarness | null = null;
  const live = (): LiveHarness => {
    if (state === null) throw new Error("useKernelHarness: call setup() first (wire kh.setup into beforeEach)");
    return state;
  };

  return {
    async setup(): Promise<void> {
      await xdg.setup();
      const cacheDir = getCacheDir();
      const stub = makeStubNotifier();
      const infra = makeKernelInfra({
        cacheDir,
        notifier: stub.notifier,
        ...(opts.client ? { client: opts.client } : {}),
        ...(opts.config ? { config: opts.config } : {}),
      });

      const order = closure(rootId);
      const built = new Map<string, Built>();
      for (const m of order) built.set(m.id, await m.build(infra));

      const rootModule = order[order.length - 1]!;
      const root = built.get(rootId)!;
      const deps: Record<string, unknown> = {};
      for (const depId of rootModule.dependsOn) deps[depId] = built.get(depId)!.api;

      const { server, callTool, callResourceList, callResource } = makeTestServer();
      const ctx = { state: root.state, writes: root.writes ?? {}, deps, infra, server };
      for (const tool of root.tools) tool.register(ctx);
      for (const resource of root.resources ?? []) resource(ctx);

      state = {
        server,
        callTool,
        callResourceList,
        callResource,
        built,
        rootState: root.state,
        rootWrites: root.writes ?? {},
        infra,
        notifier: stub.notifier,
        resourceListChanged: stub.resourceListChanged,
      };
    },
    async teardown(): Promise<void> {
      state = null;
      await xdg.teardown();
    },
    callTool: (name, args) => live().callTool(name, args),
    callToolText: async (name, args) => getText(await live().callTool(name, args)),
    callResourceList: (name) => live().callResourceList(name),
    callResource: (name, uid, uri) => live().callResource(name, uid, uri),
    seed: (data) => {
      seedBuilt(live().built, data);
    },
    state: () => live().rootState as State,
    stateOf: (id) => live().built.get(id)?.state,
    writes: () => live().rootWrites as Writes,
    infra: () => live().infra,
    notifier: () => live().notifier,
    resourceListChanged: () => live().resourceListChanged,
    client: () => live().infra.client,
  };
}
