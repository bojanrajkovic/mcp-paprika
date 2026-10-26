# MCP Surface Design: Tools vs Resources

> **Superseded by [ADR-0004](adr/0004-tool-vs-resource-classification.md) (2026-06-01), and in turn by [ADR-0026](adr/0026-drop-user-attached-resource-surface.md) (2026-10-24) for the resource half.**

The Content / Data / Reference classification heuristic that decided whether each Paprika entity was exposed as a tool, a resource, or both originated in this note and moved to ADR-0004. Its **resource half is now retired**: [ADR-0026](adr/0026-drop-user-attached-resource-surface.md) dropped the `paprika://` user-attached resource surface entirely — the MCP surface is tools (for the model) plus `ui://` widgets (for the human). What still stands from ADR-0004 is the Data (tools-only) and Reference (list + managed lifecycle) guidance.

The decision matrix and surface-audit tables this note used to carry are intentionally **not** preserved: they enumerated tool names, which drift (this note had already gone stale against the registry). The authoritative sources are:

- **Registered tools** — each domain's `module.ts` lists them in `tools: [...]`, and the kernel registers them; each tool's spec is its `defineTool(...)` in `src/**/tools/*.ts`. The generated per-tool reference (name, title, hints, parameters) is `docs/tools/README.md`.
- **Widget rendering** — the rich human views are `ui://` widgets (`src/features/widgets/`), summarized conceptually in [ADR-0019](adr/0019-mcp-app-widget-surface.md); the only other registered resource is the recipe photo proxy (`src/domains/recipe/resources/`).

This file is retained only so older links to it don't break; ADR-0004 (as amended by ADR-0026) is canonical.
