# Shared Tool Helpers

## Purpose

The few genuinely cross-cutting helpers the tool layer shares across domains — the ones that belong to no single domain (ADR-0009 §3). Domain-specific helpers (the `*ToMarkdown` formatters, the meal-type spec/resolve) live with their domain under `src/domains/<domain>/`, not here.

**Source is the catalog.** What each file exports, and why, lives in the files' own doc-comments — read them rather than an inventory here. The decisions behind the two non-obvious ones: `resources.ts`'s throw is ADR-0014's recognized form #1; `catalog.ts` is the ADR-0017 machinery.

## Sharp edges

- **`photo-fetch.ts` is the SSRF chokepoint — keep it strict.** It blocks private/loopback/link-local IPs after DNS resolution (not just by hostname), caps the body at `MAX_IMAGE_BYTES`, and is the only sanctioned way to pull a remote image. A photo `source` deliberately has no `file_path` (that would be LFI/SSRF); see `src/domains/recipe/`'s photo tooling and ADR-0004's photo notes.
- **This directory is for cross-domain leaves only.** If a helper is used by exactly one domain, it belongs in that domain. Resist the gravity that pulls unrelated helpers into a shared dir until it becomes a god-bag.
- **`toolResult()`'s two-argument form is the structured-output channel.** `toolResult(text, structuredContent)` carries a `Record<string, unknown>` payload beside the text block (a list wraps its rows as `{ items: [...] }` — `structuredContent` is a record, not a bare array); a tool using it must also declare `outputSchema` on its `ToolSpec` (kernel `CLAUDE.md`). Canonical home: `docs/architecture.md` + ADR-0019.
- **`mcp-app.ts` mirrors two ext-apps wire constants — mirror, don't import.** `@modelcontextprotocol/ext-apps` is a build-time-only devDependency (a widget's HTML is compiled self-contained and read back as a string), so nothing on the runtime path may import it or `pnpm install --prod` breaks. The MIME type and the legacy `_meta` key are mirrored as local literals and pinned to the installed package by `mcp-app.test.ts`; don't "simplify" by importing them from `@modelcontextprotocol/ext-apps/server`.
