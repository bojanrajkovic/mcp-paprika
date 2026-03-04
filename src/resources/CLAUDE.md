# MCP Resource Definitions

Last verified: 2026-03-03

## Purpose

Defines MCP resources that AI assistants can read. Resources expose data (e.g., recipe lists, categories) as structured content over the MCP protocol.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** `features/`, `types/`
- **Used by:** `index.ts` (MCP server registration)
- **Boundary:** Must not import from `paprika/` or `cache/` directly — use `features/` as the intermediary
