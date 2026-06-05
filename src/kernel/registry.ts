import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";

import type { GeneratedImageStore } from "../features/generated-image-store.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { AnySyncResult } from "../paprika/sync-types.js";
import type { IndexEventEmitter } from "../server/index-events.js";
import type { Notifier } from "../server/notifier.js";
import type { PaprikaConfig } from "../utils/config.js";

/**
 * The domain-isolation composition kernel.
 *
 * Each domain is a self-registering module that declares its dependencies and
 * exposes a public contract. Its tools, resources, and sync/boot hooks receive a
 * context narrowed to the module's own internals (`self`) plus exactly its
 * declared dependencies' contracts (`deps`); reaching anything else is a compile
 * error. A module AUGMENTS {@link DomainRegistry} from its own file and
 * self-registers on import, so dependency contracts are typed from the registry,
 * there is no central module list, and a module exports nothing across boundaries.
 *
 * Authoring is a curried builder: `defineModule(id, dependsOn).self(factory)
 * .build(self => parts)`. Fixing `Self` via `.self(...)` BEFORE the tools are
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

/** The typed boundary. Empty here; every module augments it from its own file. */
// oxlint-disable-next-line no-empty-object-type
export interface DomainRegistry {}

/** The union of all registered domain ids. `never` until a module augments. */
export type DomainId = keyof DomainRegistry;

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
   * seam rather than either module's `self`.
   */
  readonly generatedImageStore: GeneratedImageStore;
}

/**
 * The process-wide context a boot hook receives: the module's own internals
 * (`self`), exactly its declared dependencies' contracts (`deps`), and `infra`.
 * No `server` — boot phases run once per process, before any session exists.
 */
export interface BootCtx<Self, Deps extends DomainId> {
  readonly self: Self;
  readonly deps: { readonly [K in Deps]: DomainRegistry[K] };
  readonly infra: Infra;
}

/** The per-session context a tool or resource receives: a `BootCtx` plus the session server. */
export interface DomainCtx<Self, Deps extends DomainId> extends BootCtx<Self, Deps> {
  readonly server: McpServer;
}

// Post-sync boot hooks. Construction order (topo-sort) handles "built before";
// the INITIAL sync cycle (the driver below) runs next; THEN these hooks run — so
// e.g. the vector index builds against already-synced stores. Sync is the driver,
// not a hook, so the only post-sync phase is `index`; the array keeps the loop
// shape for future phases.
export type BootPhase = "index";
const BOOT_PHASES: ReadonlyArray<BootPhase> = ["index"];
type BootHooks<Self, Deps extends DomainId> = Partial<Record<BootPhase, (ctx: BootCtx<Self, Deps>) => Promise<void>>>;

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
 * do: its own store/cache via `self`, its declared deps' contracts via `deps`, the
 * Paprika client via `infra.client`. So no central all-stores context is needed. It returns
 * an `AnySyncResult` to be emitted as `sync:complete` (recipes/grocery/menus), or
 * `void` for reference/soft entities that emit nothing. `sweep` is the per-store
 * pending-write TTL sweep the driver runs once at end-of-cycle.
 */
export interface SyncContribution<Self, Deps extends DomainId> {
  readonly tier: SyncTier;
  reconcile(ctx: BootCtx<Self, Deps>): Promise<AnySyncResult | void>;
  sweep?(): number;
}

/** Kernel-facing erased sync contribution (the `Self`/`Deps` generics gone). */
interface ErasedSync {
  readonly tier: SyncTier;
  reconcile(ctx: ErasedBootCtx): Promise<AnySyncResult | void>;
  sweep?(): number;
}

/**
 * What a module's `.build(self => …)` callback returns. `api` must satisfy the
 * contract the module registered for its own id; `tools`/`resources`/`onReady` get
 * a ctx narrowed to `Self` + the `dependsOn` tuple — INFERRED, so the author writes
 * no per-module ctx alias; `flush` is optional.
 *
 * `resources` is parallel to `tools`: each entry registers an MCP resource template
 * via `ctx.server.registerResource(...)`, reading its own data via `ctx.self` and
 * any shared data via `ctx.deps.<id>` contracts. Resources are Content-domain-only
 * (recipe, grocery-list, menu — see ADR-0004), so most modules supply none.
 */
export interface ModuleParts<Id extends DomainId, Deps extends DomainId, Self> {
  readonly api: DomainRegistry[Id];
  readonly tools: ReadonlyArray<(ctx: DomainCtx<Self, Deps>) => void>;
  readonly resources?: ReadonlyArray<(ctx: DomainCtx<Self, Deps>) => void>;
  readonly syncs?: ReadonlyArray<SyncContribution<Self, Deps>>;
  readonly onReady?: BootHooks<Self, Deps>;
  readonly flush?: () => Promise<void>;
}

/** Kernel-facing erased contexts (the `DomainCtx`/`BootCtx` generics gone). */
interface ErasedBootCtx {
  readonly self: unknown;
  readonly deps: Record<string, unknown>;
  readonly infra: Infra;
}
interface ErasedCtx extends ErasedBootCtx {
  readonly server: McpServer;
}

interface ErasedBuild {
  readonly self: unknown;
  readonly api: unknown;
  readonly tools: ReadonlyArray<(ctx: ErasedCtx) => void>;
  readonly resources?: ReadonlyArray<(ctx: ErasedCtx) => void>;
  readonly syncs?: ReadonlyArray<ErasedSync>;
  readonly onReady?: Partial<Record<BootPhase, (ctx: ErasedBootCtx) => Promise<void>>>;
  readonly flush?: () => Promise<void>;
}

/** Type-erased module the kernel iterates uniformly. */
export interface ErasedModule {
  readonly id: string;
  readonly dependsOn: ReadonlyArray<string>;
  build(infra: Infra): ErasedBuild | Promise<ErasedBuild>;
}

/** The `.build(...)` step: supply the assemble callback (it receives the built
 * `self`) and get an {@link ErasedModule}. Tools/hooks infer their ctx from `Self`
 * + the dependency tuple — no per-module ctx alias to declare. */
export interface ModuleBuildStep<Id extends DomainId, DepList extends ReadonlyArray<DomainId>, Self> {
  build(assemble: (self: Self) => ModuleParts<Id, DepList[number], Self>): ErasedModule;
}

/** The `.self(...)` step: a factory that builds (and hydrates) the module's
 * internals — `Self` is inferred from its return. A module with no internals can
 * skip straight to `.build(...)` (its `self` is `{}`). */
export interface ModuleSelfStep<Id extends DomainId, DepList extends ReadonlyArray<DomainId>> extends ModuleBuildStep<
  Id,
  DepList,
  Record<never, never>
> {
  self<Self>(factory: (infra: Infra) => Self | Promise<Self>): ModuleBuildStep<Id, DepList, Self>;
}

/**
 * Author a module: `defineModule(id, dependsOn).self(factory).build(self => parts)`.
 *
 * `id` fixes which registry contract `api` must satisfy; the `const` dependency
 * tuple is the single source of truth (its element union is the tools'/hooks'
 * `deps`); `.self(...)` fixes `Self` BEFORE the tools are written, which is what
 * lets each tool/hook INFER its narrowed ctx with no per-module alias. The kept
 * cast erases the generics for uniform iteration — the kernel never reads these
 * types, only shuttles values by string id.
 */
export function defineModule<Id extends DomainId, const DepList extends ReadonlyArray<DomainId>>(
  id: Id,
  dependsOn: DepList,
): ModuleSelfStep<Id, DepList> {
  const withSelf = <Self>(factory: (infra: Infra) => Self | Promise<Self>): ModuleBuildStep<Id, DepList, Self> => ({
    build(assemble): ErasedModule {
      return {
        id,
        dependsOn,
        build: async (infra: Infra) => {
          const self = await factory(infra);
          const parts = assemble(self);
          return {
            self,
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
    self: withSelf,
    build: withSelf<Record<never, never>>(() => ({})).build,
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
  flushAll(): Promise<void>;
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
  readonly self: unknown;
  readonly tools: ReadonlyArray<(ctx: ErasedCtx) => void>;
  readonly resources: ReadonlyArray<(ctx: ErasedCtx) => void> | undefined;
  readonly syncs: ReadonlyArray<ErasedSync> | undefined;
  readonly onReady: Partial<Record<BootPhase, (ctx: ErasedBootCtx) => Promise<void>>> | undefined;
}

/**
 * Build the kernel: (0) construct every module in dependency order — each `.self`
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
  const flushers: Array<() => Promise<void>> = [];

  const depsOf = (ids: ReadonlyArray<string>): Record<string, unknown> => {
    const deps: Record<string, unknown> = {};
    for (const id of ids) deps[id] = apis.get(id);
    return deps;
  };
  const bootCtxOf = (b: Built): ErasedBootCtx => ({ self: b.self, deps: depsOf(b.dependsOn), infra });

  // Phase 0 — construction (+ per-module cache hydration).
  for (const m of order) {
    const b = await m.build(infra);
    apis.set(m.id, b.api);
    if (b.flush !== undefined) flushers.push(b.flush);
    built.push({
      id: m.id,
      dependsOn: m.dependsOn,
      self: b.self,
      tools: b.tools,
      resources: b.resources,
      syncs: b.syncs,
      onReady: b.onReady,
    });
  }

  const flushAll = async (): Promise<void> => {
    await Promise.all(flushers.map((f) => f()));
  };

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
      await flushAll();
      let swept = 0;
      for (const sweep of sweepers) swept += sweep();
      if (swept > 0) infra.log.debug({ swept }, "swept pending writes past TTL");
      // Only a cycle that reached flush reports results: a core-reconcile throw (or
      // a flush rejection) aborts the cycle. Returning the partially accumulated
      // `results` here would fan out a resource notification for an aborted,
      // un-flushed cycle — return `[]` instead so a partial cycle fans out nothing.
      return results;
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
        const ctx: ErasedCtx = { ...bootCtxOf(b), server };
        for (const tool of b.tools) tool(ctx);
        if (b.resources !== undefined) for (const resource of b.resources) resource(ctx);
      }
    },
    flushAll,
    syncOnce,
  };
}
