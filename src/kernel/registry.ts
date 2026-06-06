import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError } from "../cache/disk-cache.js";
import type { GeneratedImageStore } from "../features/generated-image-store.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { AnySyncResult } from "../paprika/sync-types.js";
import type { IndexEventEmitter } from "../server/index-events.js";
import type { Notifier } from "../server/notifier.js";
import type { PaprikaConfig } from "../utils/config.js";
import type { ToolDef, ToolSpec } from "./tool.js";

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
 * hooks' `deps`. A boot pipeline ({@link BootPhase}) sequences side-effects the
 * construction topo-sort cannot express. The sync seam follows the same shape:
 * each module contributes a `reconcile` per owned entity, reached through the same
 * {@link BootCtx}, and the kernel drives them — so a central sync needs no
 * global slice over the modules' hidden stores. See {@link SyncContribution} and
 * {@link buildKernel}.
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
 * need a sync gate — ADR-0010) does not expose it either. Each domain's header
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
   * reconcile emit here, and discover's `index` boot hook subscribes. Carried on
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
 * No `server` — boot phases run once per process, before any session exists.
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
 * mentions it. See ADR-0012.
 */
export interface DomainCtx<State, Deps extends DomainId, Writes = Record<never, never>> extends BootCtx<State, Deps> {
  readonly server: McpServer;
  readonly writes: Writes;
}

// Post-sync boot hooks. Construction order (topo-sort) handles "built before";
// the INITIAL sync cycle (the driver below) runs next; THEN these hooks run — so
// e.g. the vector index builds against already-synced stores. Sync is the driver,
// not a hook, so the only post-sync phase is `index`; the array keeps the loop
// shape for future phases.
export type BootPhase = "index";
const BOOT_PHASES: ReadonlyArray<BootPhase> = ["index"];
type BootHooks<State, Deps extends DomainId> = Partial<Record<BootPhase, (ctx: BootCtx<State, Deps>) => Promise<void>>>;

/**
 * Sync tier — three buckets the driver runs in order each cycle: reference → core →
 * additive. Tiers scope abort-blast-radius, NOT data ordering: nothing reads a sibling
 * store during reconcile (every catalog name resolves at read time), so a tier only
 * decides which reconciles a failure may take down. See docs/adr/0010-reference-sync-tier.md.
 *
 * - `reference` (the lookup catalogs: aisle, category, meal-type) runs FIRST, each in
 *   its own best-effort try/catch. A catalog fetch failure degrades to the last-good
 *   in-memory catalog rather than aborting the primary data sync.
 * - `core` (recipe, pantry, grocery) runs next, in dependency order; a core failure
 *   aborts the cycle (the driver's outer catch turns it into a logged no-op, mirroring
 *   the sync loop's never-throws contract).
 * - `additive` (meals, menus, photos) runs last, each best-effort, so a soft read
 *   surface can't abort core sync.
 */
export type SyncTier = "reference" | "core" | "additive";

/**
 * One entity's contribution to the sync cycle — the seam between a central sync
 * and module-owned (hidden) stores. A multi-entity domain supplies one per owned
 * entity via `syncs`. `reconcile` receives the SAME {@link BootCtx} the boot hooks
 * do: its own store/cache via `state`, its declared deps' contracts via `deps`, the
 * Paprika client via `infra.client`. So no central all-stores context is needed. It returns
 * an `AnySyncResult` to be emitted as `sync:complete` (recipes/grocery/menus), or
 * `void` for reference/soft entities that emit nothing. `sweep` is the per-store
 * pending-write TTL sweep the driver runs once at end-of-cycle.
 */
export interface SyncContribution<State, Deps extends DomainId> {
  readonly tier: SyncTier;
  reconcile(ctx: BootCtx<State, Deps>): Promise<AnySyncResult | void>;
  sweep?(): number;
}

/** Kernel-facing erased sync contribution (the `State`/`Deps` generics gone). */
interface ErasedSync {
  readonly tier: SyncTier;
  reconcile(ctx: ErasedBootCtx): Promise<AnySyncResult | void>;
  sweep?(): number;
}

/**
 * What a module's `.build((state, infra) => …)` callback returns. `api` must satisfy
 * the contract the module registered for its own id; `tools`/`resources`/`onReady`
 * get a ctx narrowed to `State` + the `dependsOn` tuple — INFERRED, so the author
 * writes no per-module ctx alias; `flush` is optional.
 *
 * `writes` is the module's write-chokepoint surface, surfaced to its own tools as
 * `ctx.writes`. It is assembled HERE (not in `.state`) because the chokepoints close
 * over `infra`, which `.build` receives but `.state` does not — keeping `State` a pure
 * state interface (ADR-0012). `Writes` is inferred from this object; a module with no
 * tool-invoked chokepoints omits it.
 *
 * `resources` is parallel to `tools`: each entry registers an MCP resource template
 * via `ctx.server.registerResource(...)`, reading its own data via `ctx.state` and
 * any shared data via `ctx.deps.<id>` contracts. Resources are read-only (Content
 * domains only — recipe, grocery-list, menu, see ADR-0004), so they never touch
 * `ctx.writes` and most modules supply none.
 */
export interface ModuleParts<Id extends DomainId, Deps extends DomainId, State, Writes = Record<never, never>> {
  readonly api: DomainRegistry[Id];
  readonly tools: ReadonlyArray<ToolDef<State, Deps, Writes>>;
  readonly writes?: Writes;
  readonly resources?: ReadonlyArray<(ctx: DomainCtx<State, Deps>) => void>;
  readonly syncs?: ReadonlyArray<SyncContribution<State, Deps>>;
  readonly onReady?: BootHooks<State, Deps>;
  readonly flush?: () => ResultAsync<void, CacheError>;
}

/** Kernel-facing erased contexts (the `DomainCtx`/`BootCtx` generics gone). */
interface ErasedBootCtx {
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

interface ErasedBuild {
  readonly state: unknown;
  readonly writes?: unknown;
  readonly api: unknown;
  readonly tools: ReadonlyArray<ErasedToolDef>;
  readonly resources?: ReadonlyArray<(ctx: ErasedCtx) => void>;
  readonly syncs?: ReadonlyArray<ErasedSync>;
  readonly onReady?: Partial<Record<BootPhase, (ctx: ErasedBootCtx) => Promise<void>>>;
  readonly flush?: () => ResultAsync<void, CacheError>;
}

/** Type-erased module the kernel iterates uniformly. */
export interface ErasedModule {
  readonly id: string;
  readonly dependsOn: ReadonlyArray<string>;
  build(infra: Infra): ErasedBuild | Promise<ErasedBuild>;
}

/** The `.build(...)` step: supply the assemble callback (it receives the built
 * `state` and `infra`) and get an {@link ErasedModule}. `infra` is what lets the
 * infra-dependent write chokepoints be assembled here rather than in `.state`. Tools/
 * hooks infer their ctx from `State`/`Writes` + the dependency tuple — no per-module
 * ctx alias to declare; `Writes` is inferred from the returned `writes`. */
export interface ModuleBuildStep<Id extends DomainId, DepList extends ReadonlyArray<DomainId>, State> {
  build<Writes = Record<never, never>>(
    assemble: (state: State, infra: Infra) => ModuleParts<Id, DepList[number], State, Writes>,
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
 * Author a module: `defineModule(id, dependsOn).state(factory).build((state, infra) => parts)`.
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
        build: async (infra: Infra) => {
          const state = await factory(infra);
          const parts = assemble(state, infra);
          return {
            state,
            writes: parts.writes,
            api: parts.api,
            tools: parts.tools,
            resources: parts.resources,
            syncs: parts.syncs,
            onReady: parts.onReady,
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
   * Run ONE sync cycle: reference catalogs first (best-effort), then core (recipe
   * first, then the rest in dependency order; a core throw aborts), then additive
   * best-effort, then flush + sweep. Never throws.
   * Returns the results a production wiring emits as `sync:complete` (feeding the
   * notifier subscriber) — but ONLY for a cycle that completed through flush; an
   * aborted cycle (a core throw or a flush rejection) returns `[]`, so a partial,
   * un-flushed cycle fans out no resource notification. The initial cycle already
   * ran at build time (gating the
   * post-sync hooks); the interval driver calls this on its loop.
   */
  syncOnce(): Promise<ReadonlyArray<AnySyncResult>>;
}

interface Built {
  readonly id: string;
  readonly dependsOn: ReadonlyArray<string>;
  readonly state: unknown;
  readonly writes: unknown;
  readonly tools: ReadonlyArray<ErasedToolDef>;
  readonly resources: ReadonlyArray<(ctx: ErasedCtx) => void> | undefined;
  readonly syncs: ReadonlyArray<ErasedSync> | undefined;
  readonly onReady: Partial<Record<BootPhase, (ctx: ErasedBootCtx) => Promise<void>>> | undefined;
}

/**
 * Build the kernel: (0) construct every module in dependency order — each `.state`
 * factory hydrates its own cache, so "all built" ⇒ "all caches warm"; then (1) run
 * the initial sync cycle; then (2) run the boot phases in order, each to completion
 * before the next. Returns a per-session registrar. Defaults to the self-registered
 * modules.
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

  // Phase 0 — construction (+ per-module cache hydration).
  for (const m of order) {
    const b = await m.build(infra);
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
      onReady: b.onReady,
    });
  }

  const flushAll = (): ResultAsync<void, CacheError> =>
    ResultAsync.combine(flushers.map((f) => f())).map(() => undefined);

  // The sync DRIVER (seam: central sync ↔ module-owned stores). The engine is a
  // dumb sequencer — each entity's reconcile lives in its module, reached through
  // the BootCtx (its own store/cache + declared deps + the client). Three tiers run
  // in order: reference catalogs first (best-effort), then core in dependency order
  // (a failure aborts the cycle), then additive best-effort; then flush + sweep. The
  // whole cycle never throws. Tiers scope abort-blast-radius, not data ordering —
  // nothing reads a sibling store during reconcile (ADR-0010).
  //
  // Recipe's core reconciles must LEAD the core tier: recipe must be marked synced
  // before the other core reconciles (pantry, grocery) run, so a later core failure
  // can't gate recipe tools for the interval. Recipe is dep-free, so the topo-sort
  // (which orders aisle→pantry→grocery via their dependency edges) can't hoist it — a
  // stable sort keyed on id "recipe" does. This is the one ordering the dependency DAG
  // can't express; if a second priority case ever appears, promote it to a declared
  // `SyncContribution` ordinal (copy first, abstract on the third).
  const syncOrder = [...built].sort((a, z) => (a.id === "recipe" ? -1 : 0) - (z.id === "recipe" ? -1 : 0));
  const referenceSyncs: Array<() => Promise<AnySyncResult | void>> = [];
  const coreSyncs: Array<() => Promise<AnySyncResult | void>> = [];
  const additiveSyncs: Array<() => Promise<AnySyncResult | void>> = [];
  const sweepers: Array<() => number> = [];
  for (const b of syncOrder) {
    if (b.syncs === undefined) continue;
    for (const sync of b.syncs) {
      const run = (): Promise<AnySyncResult | void> => sync.reconcile(bootCtxOf(b));
      if (sync.tier === "reference") referenceSyncs.push(run);
      else if (sync.tier === "core") coreSyncs.push(run);
      else additiveSyncs.push(run);
      if (sync.sweep !== undefined) sweepers.push(sync.sweep);
    }
  }
  const syncOnce = async (): Promise<ReadonlyArray<AnySyncResult>> => {
    const results: Array<AnySyncResult> = [];
    try {
      // Reference catalogs first, best-effort: a catalog fetch failure degrades to the
      // last-good in-memory catalog (consumers resolve names at read time and gate on
      // hasSynced) rather than aborting the primary data sync below.
      for (const run of referenceSyncs) {
        try {
          const r = await run();
          if (r !== undefined) results.push(r);
        } catch (err) {
          infra.log.warn({ err }, "reference sync failed; core sync unaffected");
        }
      }
      for (const run of coreSyncs) {
        const r = await run();
        if (r !== undefined) results.push(r);
      }
      for (const run of additiveSyncs) {
        try {
          const r = await run();
          if (r !== undefined) results.push(r);
        } catch (err) {
          infra.log.warn({ err }, "additive sync failed; core sync unaffected");
        }
      }
      // Only a cycle that reached flush reports results: a core-reconcile throw (or
      // a flush error) aborts the cycle. Returning the partially accumulated
      // `results` for an aborted, un-flushed cycle would fan out a resource
      // notification for state that never became durable — return `[]` instead.
      return (await flushAll()).match(
        () => {
          let swept = 0;
          for (const sweep of sweepers) swept += sweep();
          if (swept > 0) infra.log.debug({ swept }, "swept pending writes past TTL");
          return results;
        },
        (flushErr) => {
          infra.log.error({ err: flushErr }, "sync flush failed");
          return [];
        },
      );
    } catch (err) {
      infra.log.error({ err }, "sync failed");
      return [];
    }
  };

  // Boot: construct → run the INITIAL sync cycle → run post-sync hooks. The initial
  // cycle gates the hooks, so e.g. the vector `index` builds against already-synced
  // stores. The interval loop just calls `syncOnce` repeatedly. The startup breadcrumb
  // (#158) brackets the cycle: a failure logs `sync failed` (error) from the catch above.
  infra.log.info("running initial sync");
  // The initial cycle's results are intentionally discarded: at this point no server /
  // session exists (stdio's ServerRef is unset; HTTP has zero sessions), so a resource
  // notification would no-op. The interval
  // driver's immediate first iteration re-syncs and DOES call notifyFromResults once a
  // session can receive it. If the bootstrap order ever changes so a server exists here,
  // wire notifyFromResults onto this call too.
  await syncOnce();
  for (const phase of BOOT_PHASES) {
    for (const b of built) {
      const hook = b.onReady?.[phase];
      if (hook !== undefined) await hook(bootCtxOf(b));
    }
  }

  return {
    registerAll(server: McpServer): void {
      for (const b of built) {
        // `writes` rides the per-session ctx (tools), not the boot/sync ctx — only
        // tools invoke chokepoints. Empty when the module assembled none.
        const ctx: ErasedCtx = { ...bootCtxOf(b), writes: b.writes ?? {}, server };
        for (const tool of b.tools) tool.register(ctx);
        if (b.resources !== undefined) for (const resource of b.resources) resource(ctx);
      }
    },
    flushAll,
    syncOnce,
  };
}
