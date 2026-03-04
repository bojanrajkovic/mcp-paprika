# Paprika Type Definitions Design

## Summary

This design establishes `src/paprika/types.ts` and `src/paprika/errors.ts` as the foundational type layer for the project — the first domain types introduced into a codebase that currently has none. The goal is a single canonical source of truth for every data shape the application works with: what the Paprika API sends back over the wire, what internal modules pass between each other, and how errors are categorized and propagated.

The approach is schema-first: Zod schemas are written once and serve double duty as both runtime validators (rejecting malformed API responses at the boundary) and compile-time type generators (TypeScript types are derived from schemas via `z.infer<>` rather than declared separately). On top of that, two compile-time safety measures are layered in: branded UIDs, which prevent a recipe identifier from ever being accidentally used where a category identifier is expected; and a snake_case-to-camelCase transform baked into the schemas, so all application code works with `imageUrl` and `prepTime` while the raw API wire format (`image_url`, `prep_time`) is handled at the parsing boundary and nowhere else. The error hierarchy is kept in a companion file and uses ES2022 cause chaining so errors can be wrapped without losing the original context.

## Definition of Done

Deliver `src/paprika/types.ts` as the single canonical source of all shared types for the project. The file contains Zod schemas as the source of truth for all Paprika API response shapes (`RecipeEntry`, `Recipe`, `CategoryEntry`, `Category`, `AuthResponse`) with TypeScript types derived via `z.infer<>`. UIDs use branded types via type-fest's `Tagged<string, '...'>` to prevent mixing recipe and category UIDs at compile time. Domain types (`RecipeInput`, `SyncResult`, `DiffResult`) and error classes (`PaprikaError`, `PaprikaAuthError`, `PaprikaAPIError`) with proper inheritance and ES2022+ `ErrorOptions` support are included. All exports are consumable by every downstream unit (P1-U05 through P3-U08). `pnpm build` compiles without errors. type-fest is added as a dev dependency.

Out of scope: runtime logic, API client code, unit tests for this file (pure type declarations + error classes).

## Acceptance Criteria

### paprika-types.AC1: Zod schemas validate API responses

- **paprika-types.AC1.1 Success:** RecipeEntrySchema parses `{uid: "abc", hash: "def"}` and returns branded RecipeUid
- **paprika-types.AC1.2 Success:** RecipeSchema parses a full snake_case API response and outputs camelCase fields
- **paprika-types.AC1.3 Success:** Recipe.imageUrl is `string` (non-optional, non-nullable)
- **paprika-types.AC1.4 Success:** Recipe.categories is `CategoryUid[]` (branded, not plain string)
- **paprika-types.AC1.5 Success:** CategorySchema parses `{uid, name, order_flag, parent_uid}` with camelCase output
- **paprika-types.AC1.6 Success:** AuthResponseSchema parses `{result: {token: "..."}}`
- **paprika-types.AC1.7 Failure:** RecipeSchema rejects response missing required fields
- **paprika-types.AC1.8 Failure:** RecipeEntrySchema rejects response with non-string uid

### paprika-types.AC2: Branded UIDs prevent cross-assignment

- **paprika-types.AC2.1 Success:** RecipeUid assignable to variables typed RecipeUid
- **paprika-types.AC2.2 Failure:** RecipeUid not assignable to CategoryUid (compile error)
- **paprika-types.AC2.3 Failure:** Plain string not assignable to RecipeUid without parsing through schema

### paprika-types.AC3: Domain types are correctly shaped

- **paprika-types.AC3.1 Success:** RecipeInput requires name, ingredients, directions; all other fields optional
- **paprika-types.AC3.2 Success:** RecipeInput excludes uid, hash, created
- **paprika-types.AC3.3 Success:** SyncResult has added: Recipe[], updated: Recipe[], removedUids: string[]
- **paprika-types.AC3.4 Success:** DiffResult has added: string[], changed: string[], removed: string[]

### paprika-types.AC4: Error classes have correct hierarchy and fields

- **paprika-types.AC4.1 Success:** PaprikaAuthError instanceof PaprikaError instanceof Error
- **paprika-types.AC4.2 Success:** PaprikaAPIError exposes readonly status: number and endpoint: string
- **paprika-types.AC4.3 Success:** PaprikaAPIError formats message as "message (HTTP status from endpoint)"
- **paprika-types.AC4.4 Success:** All error classes accept ErrorOptions for cause chaining
- **paprika-types.AC4.5 Success:** Each error class sets this.name to match its class name

### paprika-types.AC5: Build and exports

- **paprika-types.AC5.1 Success:** pnpm build compiles with zero errors
- **paprika-types.AC5.2 Success:** pnpm typecheck passes
- **paprika-types.AC5.3 Success:** All schemas and types are named exports from src/paprika/types.ts
- **paprika-types.AC5.4 Success:** All error classes are named exports from src/paprika/errors.ts

## Glossary

- **Zod**: A TypeScript-first schema declaration and validation library. Define a schema once; Zod both validates data at runtime and infers the corresponding TypeScript type at compile time.
- **`z.infer<>` / `z.output<>`**: Zod utility types that extract the TypeScript type a schema produces after parsing. Equivalent for schemas without transforms; `z.output` is explicit about the post-transform shape.
- **`z.input<>`**: Zod utility type that extracts the TypeScript type a schema accepts before any transforms — the raw wire-format shape.
- **Branded type**: A compile-time technique that makes two structurally identical types (e.g., two strings) incompatible with each other by attaching a phantom tag. A `RecipeUid` and a `CategoryUid` are both strings at runtime, but the TypeScript compiler treats them as distinct types.
- **`z.brand()`**: Zod method that applies a branded type to a schema's output, making the parsed value carry a compile-time tag without any runtime wrapping.
- **type-fest**: A curated collection of TypeScript utility types. Used here for `SetRequired`.
- **`SetRequired`**: A type-fest utility. `SetRequired<T, K>` produces a version of `T` where the keys listed in `K` become required, leaving all other fields as-is.
- **Schema-first design**: Architectural pattern where data schemas are the authoritative definition of a data shape, and all other representations (TypeScript types, validators) are derived from them.
- **FCIS pattern**: Functional Core / Imperative Shell. The functional core contains pure logic with no I/O or side effects; the imperative shell handles I/O and calls into the core.
- **Leaf dependency**: A module that imports only from external packages and never from other modules in the same project. No risk of circular imports.
- **`ErrorOptions` / cause chaining**: ES2022 addition to the `Error` constructor. Passing `{ cause: originalError }` attaches the original error to a wrapper, preserving the full chain for debugging.
- **Wire format**: The exact text representation of data as transmitted over a network — the raw JSON from the Paprika API before parsing or transformation.
- **MCP**: Model Context Protocol. The protocol this server implements to expose Paprika data and actions to an AI model.

## Architecture

Single-file type module (`src/paprika/types.ts`) with a companion error module (`src/paprika/errors.ts`). Both are leaf dependencies — they import only from `zod` and `type-fest`, never from other `src/` modules.

### Schema-First Design

Zod schemas are the source of truth for all Paprika API response shapes. TypeScript types are derived via `z.infer<>` / `z.output<>`. This gives both compile-time types and runtime validation in one declaration. The client layer (P1-U05/U06) parses raw API JSON through these schemas — downstream modules never handle unvalidated data.

### Branded UIDs

UID fields use Zod's `z.brand()` to create compile-time distinct types (`RecipeUid`, `CategoryUid`). Passing a `RecipeUid` where a `CategoryUid` is expected is a type error. Branding is purely compile-time — no runtime overhead.

### CamelCase Transform

The Paprika API returns snake_case fields (`image_url`, `prep_time`, `cook_time`). Zod schemas accept snake_case input and transform to camelCase output (`imageUrl`, `prepTime`, `cookTime`). This means:

- `z.input<typeof RecipeSchema>` — snake_case (API wire format)
- `z.output<typeof RecipeSchema>` / `z.infer<typeof RecipeSchema>` — camelCase (app code)
- `RecipeInput` uses camelCase; the client layer converts back to snake_case when writing to the API

### Domain Types

Types that don't cross system boundaries (`SyncResult`, `DiffResult`) are plain `type` aliases — no Zod validation overhead. `RecipeInput` uses type-fest's `SetRequired` to enforce required fields (`name`, `ingredients`, `directions`) for recipe creation while keeping everything else optional.

### Error Hierarchy

Error classes live in `src/paprika/errors.ts`, separate from the pure schema/type file:

- `PaprikaError` — base class, generic message
- `PaprikaAuthError` — unrecoverable, bad credentials (default message: "Authentication failed")
- `PaprikaAPIError` — HTTP error with `status: number` and `endpoint: string`

All use ES2022+ `ErrorOptions` for `cause` chaining. `this.name` matches class name in each constructor.

## Existing Patterns

Investigation found no existing type definitions or Zod schemas in the codebase — `src/paprika/` contains only `.gitkeep` and `CLAUDE.md`. This design introduces the first domain types.

The project's design guidance (`.ed3d/design-plan-guidance.md`) specifies:

- **Schema-first validation** with Zod as source of truth — this design follows that
- **Branded types** via type-fest — this design uses Zod's `z.brand()` instead (simpler, no type-fest needed for branding), but adds type-fest for `SetRequired` on `RecipeInput`
- **FCIS pattern** — types.ts is pure functional core (no I/O, no side effects)
- **Domain-driven structure** with `types.ts` per domain — this design follows that exactly

The root `CLAUDE.md` convention "Use `interface` for object shapes that may be extended, `type` for unions and intersections" is superseded for API shapes by Zod-derived types (which produce `type` aliases via `z.infer`). Plain domain types (`SyncResult`, `DiffResult`) use `type` since they are fixed shapes that won't be extended.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Branded UIDs, Entry Schemas, and Dependencies

**Goal:** Install type-fest, create branded UID schemas, and entry schemas for the sync list endpoints.

**Components:**

- `type-fest` added as dev dependency via pnpm
- `src/paprika/types.ts` — `RecipeUidSchema`, `CategoryUidSchema` (branded), `RecipeEntrySchema`, `CategoryEntrySchema`
- Derived types: `RecipeUid`, `CategoryUid`, `RecipeEntry`, `CategoryEntry`

**Dependencies:** None (first phase)

**Done when:** `pnpm build` compiles, `pnpm typecheck` passes, branded UIDs prevent cross-assignment at compile time

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Full Object Schemas, Domain Types, and RecipeInput

**Goal:** Define full Recipe/Category schemas with camelCase transforms, AuthResponse, and all domain types.

**Components:**

- `src/paprika/types.ts` — `RecipeSchema` (with snake_case-to-camelCase transform), `CategorySchema`, `AuthResponseSchema`
- Derived types: `Recipe`, `Category`, `AuthResponse`
- Domain types: `RecipeInput` (via type-fest `SetRequired`), `SyncResult`, `DiffResult`

**Dependencies:** Phase 1 (UID schemas used in Recipe/Category schemas)

**Done when:** All types compile, `Recipe.imageUrl` is non-optional `string`, `Recipe.categories` is `CategoryUid[]`, `RecipeInput` requires `name`/`ingredients`/`directions`

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: Error Class Hierarchy

**Goal:** Create error classes in a separate file with proper inheritance and ES2022+ cause chaining.

**Components:**

- `src/paprika/errors.ts` — `PaprikaError`, `PaprikaAuthError`, `PaprikaAPIError`

**Dependencies:** None (errors.ts imports nothing from types.ts)

**Done when:** Error classes instantiate correctly, `instanceof` checks work through hierarchy, `PaprikaAPIError` exposes `status` and `endpoint` fields

<!-- END_PHASE_3 -->

## Additional Considerations

**Downstream impact of camelCase transform:** All downstream units (P1-U05 through P3-U08) that reference Recipe fields must use camelCase (`imageUrl`, `prepTime`). The unit spec (P1-U02) uses snake_case in its code examples — implementing agents for downstream units should follow the camelCase convention established here, not the unit spec's snake_case examples.

**RecipeInput and API writes:** The API expects snake_case when saving recipes. The client write layer (P1-U07) must convert `RecipeInput` (camelCase) back to snake_case before sending. This conversion is the client's responsibility, not the types module's.
