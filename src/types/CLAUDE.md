# Shared Type Definitions

Last verified: 2026-03-03

## Purpose

Defines TypeScript types and Zod schemas shared across modules. Schemas are the single source of truth — TypeScript types are inferred from them.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** zod
- **Used by:** All other `src/` modules
- **Boundary:** Must not import from any other `src/` module (leaf dependency)
