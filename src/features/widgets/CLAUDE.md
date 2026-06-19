# Widgets Feature

## Purpose

The kernel module that serves the interactive widget surface (ADR-0019): it registers the `ui://widget/{name}` resource and serves prebuilt, self-contained HTML for a host to render in a sandboxed iframe. It owns no Paprika entity and reads no config, registers no tool, and exposes `EmptyApi`. A tool opts a result into a widget by declaring `ToolSpec.ui.resourceUri` (the kernel maps it onto `_meta`); this module is the other half — the resource that URI points at.

Canonical home: `docs/architecture.md` ("Widget surface") + [ADR-0019](../../../docs/adr/0019-mcp-app-widget-surface.md). The build pipeline lives in `scripts/build-widgets.ts`; the dev preview in `src/transport/widget-preview.ts`.

## Sharp edges

- **`esbuild` / `esbuild-svelte` / `svelte` / `@modelcontextprotocol/ext-apps` are BUILD-TIME-only devDependencies — nothing on the runtime path may import them.** A widget's HTML is compiled to a self-contained string by `scripts/build-widgets.ts` (the ext-apps browser runtime inlined and all), and the runtime only ever reads that string. A value-import of any of them reaches `dist/` and crashes the prod container (`pnpm install --prod` omits them). `widget-preview.ts` imports `App` **type-only** (erased) for exactly this reason; the `prod-widgets` CI job (`scripts/verify-prod-widgets.mjs`) is the hard gate.
- **A missing/empty `dist/widgets` DEGRADES (warn + empty map), it does not throw.** The kernel constructs every module regardless of transport, so a hard failure at construction would brick the stdio transport and any `pnpm dev` that hasn't built widgets. The hard "widgets exist and serve" assertion lives in CI, not at boot. Run `pnpm build:widgets` (or `pnpm dev:widgets` to watch) to populate it locally.
- **One `import.meta.url`-relative path resolves `dist/widgets` from BOTH layouts** (`artifacts.ts`): the built `dist/features/widgets/` and the tsx dev run from `src/features/widgets/` both sit three levels below the repo root, so `../../..` is the root either way and the built widgets always live at `<root>/dist/widgets`. Don't "simplify" to a sibling lookup — it breaks the dev run.
- **Per-widget source dirs (`<name>/`) are excluded from BOTH tsconfigs.** A widget's `main.ts` imports `.svelte` and uses browser globals; it is compiled by esbuild, not the project's `tsc`, so widget code is NOT typechecked by `pnpm typecheck` (accepted tradeoff — ADR-0019). The module/resource files at this directory's root ARE typechecked.
- **The `ui://` URI a tool references and the resource registered here must match exactly**, and `{name}` must have a `src/features/widgets/{name}/` source dir — pinned by `test/conformance/widget-ui-references.test.ts`. The resource `list` enumerates the in-memory artifact map loaded at construction, never the directory per request.
