# Composition Kernel

Last verified: 2026-06-04

## Purpose

The typed composition kernel: the substrate every domain module registers on. It constructs modules in dependency order, drives sync and boot-phase ordering, and hands each tool/resource/hook a context narrowed to its own internals (`self`) plus exactly its declared dependencies' contracts (`deps`), with process-wide singletons in `infra`. Reaching an undeclared domain — or a declared one's internals rather than its published contract — is a compile error.

## Key References

- **`docs/adr/0009-domain-isolated-tool-modules-kernel.md`** — the canonical decision: why a bespoke kernel (over Effect / Nest / Fastify), the per-module sync seam over a dumb driver, and domain (not entity) granularity. Read it before changing the kernel's shape.
- `registry.ts` — the whole kernel: `defineModule`/`register`, the declaration-merged `DomainRegistry`, `Infra`/`BootCtx`/`DomainCtx`, `SyncContribution`, and `buildKernel`. The source is small and is the source of truth for the API; this file does not restate signatures.
- `modules.generated.ts` — the side-effect-import barrel produced by `scripts/generate-kernel-modules.ts`.

## Sharp edges

- **The barrel is generated; regenerate it when you add or remove a `module.ts`.** `buildKernel` defaults to `registeredModules()`, which is populated only by importing `modules.generated.ts`. A new domain that isn't in the barrel self-registers nowhere and silently fails to exist at runtime — with no type error. Run `pnpm generate:modules` (a filesystem glob over `src/**/module.ts`; no compiler API).
- **A module augments `DomainRegistry` via `declare module "../../kernel/registry.js"` — that path is NOT an import.** Codemods and seds that rewrite `from "…"` specifiers miss it. A stale augmentation path resolves to nothing, silently empties `keyof DomainRegistry`, and cascades into hundreds of "not assignable to keyof DomainRegistry" errors far from the cause. If a module moves, fix its augmentation specifier by hand.
- **The single `as unknown as ErasedModule` cast in `defineModule` is deliberate.** The kernel is a type-agnostic transport that shuttles values by string id; all real safety lives at the tool/boot injection sites, which are fully checked. Don't try to "fix" it without reading ADR-0009 §1 — eliminating it needs a source-parsing generator that gives up "export nothing."
- **Sync is a dumb driver over per-module reconciles, and recipe must lead.** `buildKernel`'s `syncOnce` runs `core`-tier reconciles first in dependency order (a throw aborts the cycle), then `additive` ones best-effort, then flush + sweep; the whole cycle never throws. Recipe is hoisted first by a stable sort on the id `"recipe"`: it syncs and marks its store synced before any other core reconcile, so a later core-tier abort can't leave the recipe tools gated on an unsynced store — and because recipe is dependency-free, the dependency DAG alone wouldn't pin it first. A cycle reports its `AnySyncResult[]` ONLY after reaching flush — an aborted/un-flushed cycle returns `[]`, so a partial cycle fans out no resource notification.
- **Construction → initial sync → boot phases, in that order.** Every `.self` factory hydrates its own disk cache, so "all built" ⇒ "all caches warm"; the initial `syncOnce` then runs (gating the post-sync `index` boot phase so the vector index builds against already-synced stores). The interval loop (`src/server/sync-loop.ts`) just calls `syncOnce` repeatedly.
