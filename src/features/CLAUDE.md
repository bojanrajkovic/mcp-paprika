# Feature Implementations

Last verified: 2026-03-03

## Purpose

Orchestrates business logic by composing the Paprika API client and caching layer. Provides high-level operations that tools and resources consume.

## Contracts

Contracts will be defined when this module is implemented.

## Dependencies

- **Uses:** `paprika/`, `cache/`, `types/`
- **Used by:** `tools/`, `resources/`
- **Boundary:** Must not import from `tools/` or `resources/`
