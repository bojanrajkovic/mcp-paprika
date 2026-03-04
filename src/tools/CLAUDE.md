# MCP Tool Definitions

Last verified: 2026-03-03

## Purpose

Defines MCP tools that AI assistants can invoke. Each tool maps to a capability exposed over the MCP protocol (e.g., search recipes, get recipe details).

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** `features/`, `types/`
- **Used by:** `index.ts` (MCP server registration)
- **Boundary:** Must not import from `paprika/` or `cache/` directly — use `features/` as the intermediary
