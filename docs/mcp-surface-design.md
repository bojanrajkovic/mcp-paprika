# MCP Surface Design: Tools vs Resources

> **Superseded by [ADR-0004](adr/0004-tool-vs-resource-classification.md) (2026-06-01).**

The Content / Data / Reference classification heuristic that decides whether each Paprika entity is exposed as a tool, a resource, or both, plus the reasoning behind it (notably why a `read_X` tool is not redundant with the `paprika://X/{uid}` resource), now lives in ADR-0004, which is canonical.

The decision matrix and surface-audit tables this note used to carry are intentionally **not** preserved: they enumerated tool names, which drift (this note had already gone stale against the registry). The authoritative sources are:

- **Registered tools** — each domain's `module.ts` lists them in `tools: [...]`, and the kernel registers them; each tool's spec is its `defineTool(...)` in `src/**/tools/*.ts`. The generated per-tool reference (name, title, hints, parameters) is `docs/tools/README.md`.
- **Resource rendering** — each Content domain's `resources/` (under `src/domains/`) (the metadata header and the child-inlining for container entities); summarized conceptually in ADR-0004.

This file is retained only so older links to it don't break; ADR-0004 is canonical.
