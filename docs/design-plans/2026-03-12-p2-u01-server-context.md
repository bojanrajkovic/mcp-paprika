# ServerContext Interface & Package Dependencies Design

## Summary

P2-U01 is a foundational infrastructure unit that has two deliverables: installing the `mitt` event-emitter package as a runtime dependency, and defining the `ServerContext` interface that every Phase 2 module will depend on.

`ServerContext` is a plain, immutable record holding the four long-lived objects that tool and resource handlers need: the Paprika API client, the disk cache, the recipe store, and the MCP server. It is assembled once during server startup in `src/index.ts` and passed by reference into every registration function — a lightweight form of dependency injection that avoids global singletons and makes each module's dependencies explicit. The interface is declared with `interface` rather than `type` so that Phase 3 can extend it cleanly with additional fields (e.g. a vector store for AI features) without resorting to intersection type accumulation. `PaprikaConfig` is deliberately excluded: it is only needed at bootstrap time and adding it would couple tool handlers to configuration concerns they do not use.

## Definition of Done

1. `mitt` installed as a runtime dependency (`pnpm add mitt`)
2. `src/types/server-context.ts` created and exports a `ServerContext` interface with exactly 4 fields (`client`, `cache`, `store`, `server`); all imports use `import type` and `.js` extensions
3. `src/types/CLAUDE.md` updated with module purpose, contracts, and invariants
4. `pnpm typecheck` exits 0 with no suppressions

## Acceptance Criteria

### p2-u01-server-context.AC1: mitt installed as runtime dependency

- **p2-u01-server-context.AC1.1 Success:** `package.json` `dependencies` contains `mitt`
- **p2-u01-server-context.AC1.2 Success:** `pnpm-lock.yaml` updated with mitt resolution (lockfile not stale)

### p2-u01-server-context.AC2: ServerContext interface is correct

- **p2-u01-server-context.AC2.1 Success:** `src/types/server-context.ts` exports an `interface ServerContext` (not `type`)
- **p2-u01-server-context.AC2.2 Success:** Interface has exactly 4 fields: `client: PaprikaClient`, `cache: DiskCache`, `store: RecipeStore`, `server: McpServer`
- **p2-u01-server-context.AC2.3 Success:** All 4 fields are `readonly`
- **p2-u01-server-context.AC2.4 Success:** All imports use `import type` — no value imports
- **p2-u01-server-context.AC2.5 Success:** All import paths use `.js` extension
- **p2-u01-server-context.AC2.6 Constraint:** `PaprikaConfig` is absent from the interface

### p2-u01-server-context.AC3: TypeScript compilation passes

- **p2-u01-server-context.AC3.1 Success:** `pnpm typecheck` exits 0
- **p2-u01-server-context.AC3.2 Constraint:** No `@ts-ignore` or `@ts-expect-error` suppressions in new files

### p2-u01-server-context.AC4: CLAUDE.md updated

- **p2-u01-server-context.AC4.1 Success:** `src/types/CLAUDE.md` documents `ServerContext` with field table and correct import path example

## Glossary

- **ServerContext**: A TypeScript `interface` that bundles the four shared runtime objects (`client`, `cache`, `store`, `server`) into a single immutable record passed to every tool and resource module.
- **Dependency injection (DI)**: A pattern where a module's dependencies are supplied from the outside (here, passed as a `ServerContext` argument) rather than constructed or imported internally. Makes modules testable in isolation and decouples them from startup logic.
- **`mitt`**: A tiny TypeScript event-emitter library. Installed in this unit because it is a Phase 2 runtime requirement; its first active use is in P2-U11 (the sync engine).
- **`McpServer`**: The server class from `@modelcontextprotocol/sdk` that handles the MCP wire protocol over stdio. One of the four fields in `ServerContext`.
- **`PaprikaClient`**: The HTTP client for the Paprika cloud API, implemented in Phase 1 (`src/paprika/`). Provides read and write operations against the Paprika sync endpoint.
- **`DiskCache`**: The local persistence layer implemented in Phase 1 (`src/cache/`). Stores recipe data on disk so the server can operate without hitting the network on every request.
- **`RecipeStore`**: A higher-level cache abstraction (Phase 1) that sits above `DiskCache` and exposes recipe-oriented query operations.
- **`interface` vs `type`**: In TypeScript, `interface` declarations support extension via `extends`, while `type` aliases require intersection (`&`) to combine. Using `interface` for `ServerContext` allows Phase 3 to write `interface AIServerContext extends ServerContext` cleanly.
- **`readonly`**: A TypeScript field modifier that prevents reassignment after construction. Applied to all four `ServerContext` fields to enforce that the context is wired once and never mutated.
- **`import type`**: A TypeScript import form that is erased entirely at compile time, importing only the type information and never the runtime value. Required here because `ServerContext` must not introduce unintended side-effect imports.
- **NodeNext module resolution**: The TypeScript module resolution strategy that mirrors Node.js ESM rules, requiring explicit `.js` extensions on all relative import paths.
- **`pnpm typecheck`**: The project's type-check command (`tsc --noEmit`). Compiles the entire TypeScript project without emitting output files; the sole correctness gate for a unit that has no runtime behavior to test.
- **P2-U00**: The preceding unit that verified the `McpServer` import path in `docs/verified-api.md`. P2-U01 depends on that verification to safely import `McpServer`.

---

## Architecture

P2-U01 is pure infrastructure — no behavior, no logic, no tests required beyond `pnpm typecheck`. It has two deliverables: installing the `mitt` event emitter package, and defining the `ServerContext` interface that every Phase 2 tool and resource module depends on.

`ServerContext` is a plain record type used as a dependency injection vehicle. It is constructed once in `src/index.ts` during server bootstrap and passed by reference into every tool/resource registration function. It is never mutated after construction.

```typescript
// src/types/server-context.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";
import type { RecipeStore } from "../cache/recipe-store.js";

export interface ServerContext {
  readonly client: PaprikaClient;
  readonly cache: DiskCache;
  readonly store: RecipeStore;
  readonly server: McpServer;
}
```

`interface` is used instead of `type` because `ServerContext` is an intentionally extensible object shape — Phase 3 can add fields (e.g. `vectorStore`, `embeddingClient`) by declaring `interface AIServerContext extends ServerContext`. Using `type` would force intersection syntax instead.

All fields are `readonly` — the context is wired once and threaded through unchanged.

`PaprikaConfig` is intentionally excluded. Config is only needed in `src/index.ts` during bootstrap; no Phase 2 tool handler requires access to it. Adding it would widen the interface unnecessarily and couple tool modules to configuration concerns.

`mitt` is installed here as a Phase 2 runtime dependency checkpoint, even though its usage begins in P2-U11 (the sync engine). `neverthrow` is already present from Phase 1 (`^8.2.0`) and requires no action.

---

## Existing Patterns

`src/types/` is an empty placeholder directory created in P1-U01. `server-context.ts` is the first real file placed there.

The rest of the codebase uses `type` exclusively for object shapes, but all those shapes are Zod-inferred (`type Foo = z.infer<typeof FooSchema>`). `ServerContext` is the first manually-defined object shape — holding class instances that cannot be described by Zod schemas. Using `interface` here is correct per the project's CLAUDE.md guideline ("use `interface` for object shapes that may be extended") and does not contradict the Zod-inferred `type` pattern elsewhere.

All import paths in the codebase consistently use `.js` extensions (NodeNext module resolution). This design follows the same convention.

---

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Install `mitt` and Define `ServerContext`

**Goal:** Add the remaining Phase 2 runtime dependency and create the canonical shared context type.

**Components:**

- `package.json` — add `mitt` to `dependencies` via `pnpm add mitt`
- `src/types/server-context.ts` — new file exporting `ServerContext` interface (4 readonly fields, all `import type`, `.js` extensions)
- `src/types/CLAUDE.md` — update placeholder with module purpose, `ServerContext` field table, and import example

**Dependencies:** Phase 1 complete (PaprikaClient, DiskCache, RecipeStore all exist); P2-U00 complete (McpServer import path verified in `docs/verified-api.md`)

**Done when:** `pnpm add mitt` succeeds and lockfile is updated; `src/types/server-context.ts` exists with correct interface; `pnpm typecheck` exits 0

<!-- END_PHASE_1 -->

---

## Additional Considerations

**Extensibility:** Using `interface` instead of `type` allows Phase 3 to extend `ServerContext` cleanly:

```typescript
interface AIServerContext extends ServerContext {
  readonly vectorStore: VectorStore;
  readonly embeddingClient: EmbeddingClient;
}
```

This avoids intersection type accumulation (`ServerContext & { vectorStore: VectorStore }`) as Phase 3 adds fields.
