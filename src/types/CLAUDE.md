# Shared Type Definitions

Last verified: 2026-05-15

## Purpose

Defines TypeScript interfaces and types shared across modules. Historically this directory was the home of `ServerContext` — the dependency-injection record passed into every tool and resource. As of Phase 1 of the HTTP-transport work, the authoritative context types live in `src/server/app-context.ts` (`AppContext`, `SessionContext`) and `ServerContext` is retained here as a thin backward-compat alias.

## Contracts

### ServerContext (alias for SessionContext)

```typescript
export type ServerContext = SessionContext;
```

`ServerContext` re-exports `SessionContext` from `../server/app-context.js`. All existing tool/resource handlers that took `ServerContext` continue to work unchanged, and now also have `ctx.notifier` and `ctx.vectorStore` available on `ctx`.

| Field         | Type                  | Description                                                        |
| ------------- | --------------------- | ------------------------------------------------------------------ |
| `client`      | `PaprikaClient`       | HTTP client for the Paprika cloud API                              |
| `cache`       | `DiskCache`           | Local on-disk persistence layer                                    |
| `store`       | `RecipeStore`         | Higher-level recipe query abstraction over DiskCache               |
| `pantryStore` | `PantryStore`         | In-memory pantry query layer                                       |
| `vectorStore` | `VectorStore \| null` | Semantic-search index; `null` when embeddings are not configured   |
| `notifier`    | `Notifier`            | Abstraction for MCP notifications (resource-list-changed, logging) |
| `server`      | `McpServer`           | Per-session MCP wire protocol handler                              |

All fields are `readonly`.

**Authoritative types** (prefer these in new code):

- `AppContext` — process-wide shared state (everything except `server`). Built once per process by `buildAppContext`.
- `SessionContext` — `AppContext` plus the per-session `server: McpServer`. Built per session by `buildMcpServer` (once for stdio, once per HTTP session in Phase 3).

See `src/server/CLAUDE.md` for the AppContext/SessionContext split, the Notifier contract, and the deferred-getter pattern that resolves the stdio chicken-and-egg between notifier construction and server construction.

**Correct imports:**

```typescript
// New code — preferred:
import type { AppContext, SessionContext } from "../server/app-context.js";

// Existing handlers — still valid:
import type { ServerContext } from "../types/server-context.js";
```

## Dependencies

- **Uses:** `../server/app-context.js` (re-exports `SessionContext` as `ServerContext`)
- **Used by:** All existing tool and resource modules
- **Boundary:** All imports in this module use `import type` — no runtime value imports
