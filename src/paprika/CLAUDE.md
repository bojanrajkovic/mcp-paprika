# Paprika API Client

Last verified: 2026-03-03

## Files

- `types.ts` — Zod schemas and TypeScript types for Paprika API wire format
- `errors.ts` — Error class hierarchy for API operations

## Purpose

HTTP client for the Paprika Cloud Sync API. Handles authentication, request formatting, and response parsing for recipe data.

## Contracts

### Type Definitions (types.ts)

**Branded UIDs:**

- `RecipeUid` — Branded string type for recipe identifiers, validated by `RecipeUidSchema`
- `CategoryUid` — Branded string type for category identifiers, validated by `CategoryUidSchema`

**Entry Types:**

- `RecipeEntry` — `{uid: RecipeUid, hash: string}`
- `CategoryEntry` — `{uid: CategoryUid, hash: string}`

**Object Types (API responses with snake_case → camelCase transforms):**

- `Recipe` — Full recipe object with 28 fields; output of `RecipeSchema`
- `Category` — Category with `uid`, `name`, `orderFlag`, `parentUid`; output of `CategorySchema`
- `AuthResponse` — Authentication response `{result: {token: string}}`; output of `AuthResponseSchema`

**Domain Types:**

- `RecipeInput` — Recipe creation/update input (requires `name`, `ingredients`, `directions`; excludes `uid`, `hash`, `created`)
- `SyncResult` — `{added: Recipe[], updated: Recipe[], removedUids: string[]}`
- `DiffResult` — `{added: string[], changed: string[], removed: string[]}`

### Zod Schemas

All schemas accept snake_case input (API wire format) and transform to camelCase for application use:

- `RecipeSchema` — Validates and transforms full recipe objects
- `CategorySchema` — Validates and transforms category objects
- `AuthResponseSchema` — Validates authentication responses
- Entry schemas: `RecipeEntrySchema`, `CategoryEntrySchema`
- UID schemas: `RecipeUidSchema`, `CategoryUidSchema`

### Error Hierarchy (errors.ts)

Three-class hierarchy, all supporting ES2024 `ErrorOptions` for cause chaining:

- `PaprikaError` — Base class for all Paprika-related errors
- `PaprikaAuthError extends PaprikaError` — Authentication failures (default message: "Authentication failed")
- `PaprikaAPIError extends PaprikaError` — HTTP errors; carries `readonly status: number` and `readonly endpoint: string`; message formatted as `"message (HTTP status from endpoint)"`

## Dependencies

- **Uses:** `zod` (validation), `type-fest` (type utilities)
- **Used by:** `features/`, `tools/`, `resources/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
