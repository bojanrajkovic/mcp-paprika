# Shared Type Definitions

Last verified: 2026-03-13

## Purpose

Defines TypeScript interfaces and types shared across Phase 2 modules. `ServerContext` is the primary export — it bundles the four shared runtime objects into a single immutable record used as a dependency injection vehicle throughout the codebase.

## Contracts

### ServerContext

A plain immutable record passed by reference into every tool and resource registration function. Constructed once during server startup in `src/index.ts` and never mutated.

| Field    | Type            | Description                                          |
| -------- | --------------- | ---------------------------------------------------- |
| `client` | `PaprikaClient` | HTTP client for the Paprika cloud API                |
| `cache`  | `DiskCache`     | Local on-disk persistence layer                      |
| `store`  | `RecipeStore`   | Higher-level recipe query abstraction over DiskCache |
| `server` | `McpServer`     | MCP wire protocol handler (stdio transport)          |

All fields are `readonly`. The interface is declared with `interface` (not `type`) so Phase 3 can extend it cleanly via `extends`.

**Correct import:**

```typescript
import type { ServerContext } from "../types/server-context.js";
```

## Dependencies

- **Uses:** `@modelcontextprotocol/sdk/server/mcp.js` (McpServer), `../paprika/client.js` (PaprikaClient), `../cache/disk-cache.js` (DiskCache), `../cache/recipe-store.js` (RecipeStore)
- **Used by:** All Phase 2 tool and resource modules
- **Boundary:** All imports in this module use `import type` — no runtime value imports
