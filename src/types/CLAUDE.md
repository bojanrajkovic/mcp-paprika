# Shared Type Definitions

Last verified: 2026-06-01

## Purpose

Defines TypeScript types shared across modules. Historically this directory was the home of `ServerContext` (the dependency-injection record passed into every tool and resource). The authoritative context types now live in `src/server/app-context.ts` (`AppContext`, `SessionContext`); `ServerContext` is retained here only as a thin backward-compat alias.

## Contracts

### ServerContext

```typescript
export type ServerContext = SessionContext;
```

`ServerContext` re-exports `SessionContext` from `../server/app-context.js`, so existing handlers typed against `ServerContext` keep working unchanged. The field set is defined in `../server/app-context.ts` and documented in `../server/CLAUDE.md`; this file does not re-list it, to avoid the drift that left the prior field table a stale 7-field subset.

**Prefer the authoritative types in new code:**

```typescript
import type { AppContext, SessionContext } from "../server/app-context.js";
```

`AppContext` is process-wide shared state (built once by `buildAppContext`); `SessionContext` is `AppContext` plus the per-session `server: McpServer`. See `../server/CLAUDE.md` for the split and the deferred-getter bootstrap pattern.

## Dependencies

- **Uses:** `../server/app-context.js` (re-exports `SessionContext` as `ServerContext`)
- **Used by:** existing tool and resource modules that import `ServerContext`
- **Boundary:** all imports use `import type`, no runtime value imports
