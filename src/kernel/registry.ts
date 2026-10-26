import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { context, trace } from "@opentelemetry/api";
import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError } from "../cache/disk-cache.js";
import type { GeneratedImageStore } from "../features/generated-image-store.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { IndexEventEmitter } from "../server/index-events.js";
import type { Notifier } from "../server/notifier.js";
import type { PaprikaConfig } from "../utils/config.js";
import type { ResourceDef, ResourceSpec } from "./resource.js";
import type { ErasedSync, SyncContribution, SyncCycle, SyncTrigger } from "./sync.js";
import type { ToolDef, ToolSpec } from "./tool.js";

import { getTracer } from "../telemetry/scope.js";
import { errorTypeName, startOperation, tracePromise } from "../telemetry/trace-result.js";
import { buildSyncDriver } from "./sync.js";

/**
 * The domain-isolation composition kernel.
 *
 * Each domain is a self-registering module that declares its dependencies and
 * exposes a public contract. Its tools, resources, and sync/boot hooks receive a
 * context narrowed to the module's own internals (`state`) plus exactly its
 * declared dependencies' contracts (`deps`); reaching anything else is a compile
 * error. A module AUGMENTS {@link DomainRegistry} from its own file and
 * self-registers on import, so dependency contracts are typed from the registry,
 * there is no central module list, and a module exports nothing across boundaries.
 *
 * Authoring is a curried builder: `defineModule(id, dependsOn).state(factory)
 * .build(state => parts)`. Fixing `State` via `.state(...)` BEFORE the tools are
 * written is what lets each tool/hook INFER its narrowed ctx with no per-module
 * ctx alias. The single `as unknown as` cast in {@link defineModule} is deliberate:
 * the kernel is a type-agnostic transport that only shuttles values by string id,
 * and all real safety lives at the tool/boot injection sites, which are fully
 * checked.
 *
 * `dependsOn` is the single source of truth — its element union is the tools' and
 * hooks' `deps`. A post-sync boot hook ({@link ModuleParts.onIndexReady}) sequences
 * side-effects the construction topo-sort cannot express. Each module contributes a
 * {@link SyncContribution} per owned entity; the sync driver in `./sync.ts` runs them.
 */

/**
 * The typed boundary. Empty here; every module augments it from its own file.
 *
 * This one MUST stay an empty `interface` with the lint suppression — it is the
 * `declare module` merge target, and only an interface can be merged into. It
 * cannot use {@link EmptyApi} (a `type` alias is not a mergeable declaration), so
 * the suppression here is structural, not an oversight. The leaf contracts that
 * expose nothing DO use {@link EmptyApi} instead.
 */
// oxlint-disable-next-line no-empty-object-type
export interface DomainRegistry {}

/** The union of all registered domain ids. `never` until a module augments. */
export type DomainId = keyof DomainRegistry;

/**
 * The contract of a module that exposes nothing to siblings — a pure consumer
 * (grocery, meal-planner) or a feature (discover, photo-gen). `{}` satisfies it,
 * but unlike `interface X {}` it does not trip `no-empty-object-type`, so an empty
 * contract needs no lint suppression. The same `Record<never, never>` the kernel
 * uses for an empty `writes` seam (see {@link DomainCtx}).
 */
export type EmptyApi = Record<never, never>;

/**
 * The cross-domain sync gate: whether a domain's backing store(s) have completed a
 * first sync. Mixed into a contract via `extends` (recipe, meal, menu, meal-type,
 * pantry) so the method is declared once, not re-typed per `api.ts`.
 *
 * Exposure is demand-driven, NOT universal. A contract carries `hasSynced()` ONLY
 * where a SIBLING gates a cross-domain call on it. Every store already HAS a
 * `hasSynced` (the `EntityStore` base property) for INTERNAL self-gating — grocery
 * (`groceryStartGuard`) and aisle gate their own tools via `state.store.hasSynced`
 * and expose nothing — so the {@link EmptyApi} contracts stay empty, and aisle (read
 * cross-domain, but whose consumers resolve against the last-good catalog and never
 * need a sync gate) does not expose it either. Each domain's header
 * records what its gate guards.
 */
export interface HasSynced {
  /** Whether this domain's backing store(s) have completed their first sync. */
  hasSynced(): boolean;
}

/**
 * The universal seam every domain receives. `cacheDir` is a bare directory path, not
 * a shared cache root — each module builds its own `DiskCache` under it.
 */
export interface Infra {
  readonly client: PaprikaClient;
  readonly cacheDir: string;
  readonly notifier: Notifier;
  readonly log: Logger;
  /** The root's single parsed config — modules read it instead of re-`loadConfig()`-ing. */
  readonly config: PaprikaConfig;
  /**
   * The recipe/category → discover re-index seam: recipe writes and the category
   * reconcile emit here, and discover's `onIndexReady` hook subscribes. Carried on
   * `infra` because there is no dependency edge into discover (its contract is
   * empty by design). See {@link IndexEventEmitter}.
   */
  readonly indexEvents: IndexEventEmitter;
  /**
   * The ephemeral AI-photo preview ring buffer (`gen_…` token → bytes). photo-gen's
   * `generate_recipe_photo` (attach:false) stashes here and recipe's
   * `upload_recipe_photo` (generation_token) consumes — a recipe↔photo-gen handoff
   * that would otherwise be a dependency cycle, so it rides `infra` like a shared
   * seam rather than either module's `state`.
   */
  readonly generatedImageStore: GeneratedImageStore;
}

/**
 * The process-wide context a boot hook receives: the module's own internals
 * (`state`), exactly its declared dependencies' contracts (`deps`), and `infra`.
 * No `server` — boot-time code runs once per process, before any session exists.
 */
export interface BootCtx<State, Deps extends DomainId> {
  readonly state: State;
  readonly deps: { readonly [K in Deps]: DomainRegistry[K] };
  readonly infra: Infra;
}

/**
 * The per-session context a tool or resource receives: a `BootCtx` plus the session
 * server and the module's write chokepoints.
 *
 * `writes` is the third per-module seam (alongside `state` and `deps`): the
 * commit/persist closures the module's own tools invoke. They are assembled in
 * `.build` because they close over `infra` (the Paprika client / notifier), so they
 * cannot live in the `.state`-typed object — keeping `state` a pure state interface.
 * `Writes` defaults to empty, so a read-only tool keeps a two-generic ctx and never
 * mentions it.
 */
export interface DomainCtx<State, Deps extends DomainId, Writes = Record<never, never>> extends BootCtx<State, Deps> {
  readonly server: McpServer;
  readonly writes: Writes;
}

// Post-sync boot hook (see ModuleParts.onIndexReady below). Construction order
// (topo-sort) handles "built before"; the INITIAL sync cycle (the driver in
// ./sync.ts) runs next; THEN this hook runs — so e.g. the vector index builds against
// already-synced stores. Sync is the driver, not a hook. One hook, one consumer
// (discover) — reintroduce a phase array only when a second post-sync phase
// actually exists.

/**
 * What a module's `.build((state, infra, deps) => …)` callback returns. `api` must satisfy
 * the contract the module registered for its own id; `tools`/`resources`/`onIndexReady`
 * get a ctx narrowed to `State` + the `dependsOn` tuple — INFERRED, so the author
 * writes no per-module ctx alias; `flush` is optional.
 *
 * `writes` is the module's write-chokepoint surface, surfaced to its own tools as
 * `ctx.writes`. It is assembled HERE (not in `.state`) because the chokepoints close
 * over `infra`, which `.build` receives but `.state` does not — keeping `State` a pure
 * state interface. `Writes` is inferred from this object; a module with no
 * tool-invoked chokepoints omits it.
 *
 * `resources` is parallel to `tools`: each entry is a `defineResource` {@link ResourceDef}
 * the kernel registers via `resource.register(ctx)`, reading its own data via
 * `ctx.state` and any shared data via `ctx.deps.<id>` contracts. Resources are
 * read-only (the recipe photo proxy and the widgets feature — both `ui://`; ADR-0026
 * removed the `paprika://` content resources), so they never touch `ctx.writes` and
 * most modules supply none.
 */
export interface ModuleParts<Id extends DomainId, Deps extends DomainId, State, Writes = Record<never, never>> {
  readonly api: DomainRegistry[Id];
  readonly tools: ReadonlyArray<ToolDef<State, Deps, Writes>>;
  readonly writes?: Writes;
  readonly resources?: ReadonlyArray<ResourceDef<State, Deps>>;
  readonly syncs?: ReadonlyArray<SyncContribution<State, Deps>>;
  /** Runs once, after the initial sync cycle (see the boot-hook note above `ModuleParts`). */
  readonly onIndexReady?: (ctx: BootCtx<State, Deps>) => Promise<void>;
  readonly flush?: () => ResultAsync<void, CacheError>;
}

/** Kernel-facing erased contexts (the `DomainCtx`/`BootCtx` generics gone). */
export interface ErasedBootCtx {
  readonly state: unknown;
  readonly deps: Record<string, unknown>;
  readonly infra: Infra;
}
interface ErasedCtx extends ErasedBootCtx {
  readonly server: McpServer;
  readonly writes: unknown;
}

/** Kernel-facing erased tool def (the `State`/`Deps` generics gone). */
interface ErasedToolDef {
  readonly spec: ToolSpec;
  register(ctx: ErasedCtx): void;
}

/** Kernel-facing erased resource def (the `State`/`Deps` generics gone). */
interface ErasedResourceDef {
  readonly spec: ResourceSpec;
  register(ctx: ErasedCtx): void;
}

interface ErasedBuild {
  readonly state: unknown;
  readonly writes?: unknown;
  readonly api: unknown;
  readonly tools: ReadonlyArray<ErasedToolDef>;
  readonly resources?: ReadonlyArray<ErasedResourceDef>;
  readonly syncs?: ReadonlyArray<ErasedSync>;
  readonly onIndexReady?: (ctx: ErasedBootCtx) => Promise<void>;
  readonly flush?: () => ResultAsync<void, CacheError>;
}

/** Type-erased module the kernel iterates uniformly. */
export interface ErasedModule {
  readonly id: string;
  readonly dependsOn: ReadonlyArray<string>;
  build(infra: Infra, deps: Record<string, unknown>): ErasedBuild | Promise<ErasedBuild>;
}

/** The `.build(...)` step: supply the assemble callback (it receives the built
 * `state`, `infra`, and the module's declared dependencies' contracts `deps`) and get
 * an {@link ErasedModule}. `infra` is what lets the infra-dependent write chokepoints
 * be assembled here rather than in `.state`; `deps` carries exactly the `dependsOn`
 * tuple's already-built contracts (the kernel constructs in dependency order, so they
 * are in hand by the time `assemble` runs) — the SAME `{ [K in DepList[number]]:
 * DomainRegistry[K] }` shape `BootCtx`/`DomainCtx` use, so an `api` method can project
 * across a domain boundary symmetrically with the tool/sync/boot ctx. Tools/hooks infer
 * their ctx from `State`/`Writes` + the dependency tuple — no per-module ctx alias to
 * declare; `Writes` is inferred from the returned `writes`. A 2-arg `(state, infra)`
 * assemble stays valid (it ignores the extra `deps` argument). */
export interface ModuleBuildStep<Id extends DomainId, DepList extends ReadonlyArray<DomainId>, State> {
  build<Writes = Record<never, never>>(
    assemble: (
      state: State,
      infra: Infra,
      deps: { readonly [K in DepList[number]]: DomainRegistry[K] },
    ) => ModuleParts<Id, DepList[number], State, Writes>,
  ): ErasedModule;
}

/** The `.state(...)` step: a factory that builds (and hydrates) the module's
 * internals — `State` is inferred from its return. A module with no internals can
 * skip straight to `.build(...)` (its `state` is `{}`). */
export interface ModuleStateStep<Id extends DomainId, DepList extends ReadonlyArray<DomainId>> extends ModuleBuildStep<
  Id,
  DepList,
  Record<never, never>
> {
  state<State>(factory: (infra: Infra) => State | Promise<State>): ModuleBuildStep<Id, DepList, State>;
}

/**
 * Author a module: `defineModule(id, dependsOn).state(factory).build((state, infra, deps) => parts)`.
 *
 * `id` fixes which registry contract `api` must satisfy; the `const` dependency
 * tuple is the single source of truth (its element union is the tools'/hooks'
 * `deps`); `.state(...)` fixes `State` BEFORE the tools are written, which is what
 * lets each tool/hook INFER its narrowed ctx with no per-module alias. The kept
 * cast erases the generics for uniform iteration — the kernel never reads these
 * types, only shuttles values by string id.
 */
export function defineModule<Id extends DomainId, const DepList extends ReadonlyArray<DomainId>>(
  id: Id,
  dependsOn: DepList,
): ModuleStateStep<Id, DepList> {
  const withState = <State>(
    factory: (infra: Infra) => State | Promise<State>,
  ): ModuleBuildStep<Id, DepList, State> => ({
    build(assemble): ErasedModule {
      return {
        id,
        dependsOn,
        build: async (infra: Infra, deps: { readonly [K in DepList[number]]: DomainRegistry[K] }) => {
          const state = await factory(infra);
          const parts = assemble(state, infra, deps);
          return {
            state,
            writes: parts.writes,
            api: parts.api,
            tools: parts.tools,
            resources: parts.resources,
            syncs: parts.syncs,
            onIndexReady: parts.onIndexReady,
            flush: parts.flush,
          };
        },
      } as unknown as ErasedModule;
    },
  });
  return {
    state: withState,
    build: withState<Record<never, never>>(() => ({})).build,
  };
}

const sink: Array<ErasedModule> = [];

/** A module self-registers by calling this at import time. */
export function register(m: ErasedModule): void {
  sink.push(m);
}

/** The self-registered modules (populated by importing the module files). */
export function registeredModules(): ReadonlyArray<ErasedModule> {
  return sink;
}

function topoSort(modules: ReadonlyArray<ErasedModule>): Array<ErasedModule> {
  const byId = new Map(modules.map((m) => [m.id, m] as const));
  const done = new Set<string>();
  const onStack = new Set<string>();
  const order: Array<ErasedModule> = [];
  const visit = (m: ErasedModule): void => {
    if (done.has(m.id)) return;
    if (onStack.has(m.id)) throw new Error(`kernel: dependency cycle at "${m.id}"`);
    onStack.add(m.id);
    for (const depId of m.dependsOn) {
      const dep = byId.get(depId);
      if (dep === undefined) throw new Error(`kernel: "${m.id}" depends on unknown module "${depId}"`);
      visit(dep);
    }
    onStack.delete(m.id);
    done.add(m.id);
    order.push(m);
  };
  for (const m of modules) visit(m);
  return order;
}

export interface Kernel {
  /** Per-session: register every module's tools and resources on the server, each narrowed. */
  registerAll(server: McpServer): void;
  /** Flush every module that owns a cache — only if a snapshot is wanted. */
  flushAll(): ResultAsync<void, CacheError>;
  /**
   * Run ONE sync cycle (tiered reconciles, then flush + sweep; see
   * {@link buildSyncDriver}). Never throws.
   * Returns the cycle's `outcome` plus its per-entity change results, which feed the
   * change-count metrics. Results come back ONLY for a cycle that completed through
   * flush; an aborted cycle (a core `err` or a flush error) returns `[]`, so a partial,
   * un-flushed cycle counts no changes. The interval driver reads `outcome` to pace its
   * next cycle (`core_partial` retries sooner). The initial cycle already ran at build
   * time (gating the post-sync hooks); the interval driver calls this on its loop.
   *
   * `trigger` only labels telemetry (the cycle span + duration histogram);
   * behavior is identical. buildKernel's internal initial call passes "boot";
   * every external caller is the interval path and takes the default.
   */
  syncOnce(trigger?: SyncTrigger): Promise<SyncCycle>;
}

interface Built {
  readonly id: string;
  readonly dependsOn: ReadonlyArray<string>;
  readonly state: unknown;
  readonly writes: unknown;
  readonly tools: ReadonlyArray<ErasedToolDef>;
  readonly resources: ReadonlyArray<ErasedResourceDef> | undefined;
  readonly syncs: ReadonlyArray<ErasedSync> | undefined;
  readonly onIndexReady: ((ctx: ErasedBootCtx) => Promise<void>) | undefined;
}

/**
 * Build the kernel: (0) construct every module in dependency order — each `.state`
 * factory hydrates its own cache, so "all built" ⇒ "all caches warm"; then (1) run
 * the initial sync cycle; then (2) run every module's `onIndexReady` hook. Returns
 * a per-session registrar. Defaults to the self-registered modules.
 */
export async function buildKernel(
  infra: Infra,
  modules: ReadonlyArray<ErasedModule> = registeredModules(),
): Promise<Kernel> {
  const order = topoSort(modules);
  const apis = new Map<string, unknown>();
  const built: Array<Built> = [];
  const flushers: Array<() => ResultAsync<void, CacheError>> = [];

  const depsOf = (ids: ReadonlyArray<string>): Record<string, unknown> => {
    const deps: Record<string, unknown> = {};
    for (const id of ids) deps[id] = apis.get(id);
    return deps;
  };
  const bootCtxOf = (b: Built): ErasedBootCtx => ({ state: b.state, deps: depsOf(b.dependsOn), infra });

  // The boot trace: one root span covering construction → initial sync →
  // the onIndexReady hook (the cycle and reconcile spans parent under it via the
  // active context), with a child per module build. Boot is the one place per-module
  // timing matters — every .state factory hydrates its disk caches serially in
  // dependency order, so a slow startup names its culprit here. A build or
  // hook that throws (boot fail-fast) ends the open spans
  // as errors on its way out: the startup-failure path flushes telemetry, and
  // only ENDED spans export — the boot trace is exactly the diagnostics a
  // failed boot needs.
  const bootOp = startOperation(getTracer(), "mcp_paprika.boot", {});
  const inBoot = async <V>(fn: () => Promise<V>): Promise<V> => {
    try {
      return await context.with(trace.setSpan(context.active(), bootOp.span), fn);
    } catch (cause) {
      bootOp.end({ errorType: errorTypeName(cause), isError: true, exception: cause });
      throw cause;
    }
  };

  // Phase 0 — construction (+ per-module cache hydration).
  await inBoot(async () => {
    for (const m of order) {
      // async wrapper: ErasedModule.build may return a plain value or a promise.
      const b = await tracePromise(getTracer(), `boot.build_module ${m.id}`, {}, async () =>
        m.build(infra, depsOf(m.dependsOn)),
      );
      apis.set(m.id, b.api);
      if (b.flush !== undefined) flushers.push(b.flush);
      built.push({
        id: m.id,
        dependsOn: m.dependsOn,
        state: b.state,
        writes: b.writes,
        tools: b.tools,
        resources: b.resources,
        syncs: b.syncs,
        onIndexReady: b.onIndexReady,
      });
    }
  });

  const flushAll = (): ResultAsync<void, CacheError> =>
    ResultAsync.combine(flushers.map((f) => f())).map(() => undefined);

  const syncOnce = buildSyncDriver({
    modules: built.map((b) => ({ id: b.id, syncs: b.syncs, ctx: () => bootCtxOf(b) })),
    flushAll,
    log: infra.log.child({ component: "sync" }),
  });

  // Boot: construct → run the INITIAL sync cycle → run the post-sync onIndexReady
  // hook. The initial cycle gates the hook, so e.g. the vector index builds against
  // already-synced stores. The interval loop just calls `syncOnce` repeatedly. The
  // startup breadcrumb (#158) brackets the cycle: a failure logs `sync failed`
  // (error) from the driver in ./sync.ts.
  infra.log.info("running initial sync");
  // The initial cycle's results are intentionally discarded — the interval driver
  // re-syncs immediately to keep the cache warm, and nothing consumes a cycle's results.
  await inBoot(async () => {
    await syncOnce("boot");
    // Span name kept verbatim as "boot.phase index" (pre-collapse dashboards key on it).
    await tracePromise(getTracer(), "boot.phase index", {}, async () => {
      for (const b of built) {
        if (b.onIndexReady !== undefined) await b.onIndexReady(bootCtxOf(b));
      }
    });
  });
  bootOp.end();

  return {
    registerAll(server: McpServer): void {
      for (const b of built) {
        // `writes` rides the per-session ctx (tools), not the boot/sync ctx — only
        // tools invoke chokepoints. Empty when the module assembled none.
        const ctx: ErasedCtx = { ...bootCtxOf(b), writes: b.writes ?? {}, server };
        for (const tool of b.tools) tool.register(ctx);
        if (b.resources !== undefined) for (const resource of b.resources) resource.register(ctx);
      }
    },
    flushAll,
    syncOnce,
  };
}
