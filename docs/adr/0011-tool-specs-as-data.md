# ADR-0011: Tool specs as data (boot-free tool-reference generation)

**Status:** Accepted (2026-06-04)
**Refines:** [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) (the kernel's module/tool shape)

## Context

`docs/tools/README.md` is generated from the code so it can't go stale by hand. The generator (`scripts/generate-tool-reference.ts`) produced it by **booting the runtime and introspecting it**: it stubbed an `Infra`, called `buildKernel` (constructing every store, hydrating a temp cache, running a doomed initial `syncOnce` against a Proxy client), built an `McpServer`, ran `registerAll`, and then reached into the SDK's **private** `server._registeredTools` to read each tool's `description` + `inputSchema`.

Three problems:

- **It depended on an undocumented SDK private (`_registeredTools`).** A `@modelcontextprotocol/sdk` bump that renames or removes that field breaks doc-gen with no type error.
- **It booted a whole kernel + `McpServer` + a doomed sync** just to read static metadata.
- **It recovered only part of the metadata** — `name`/`description`/`inputSchema`; `title` and `annotations` (the read-only / destructive / idempotent hints) were dropped.

The one thing that boot-introspection bought, and which any replacement must keep, is a **no-drift** property: because it read the _live_ registry, the doc described exactly what was registered. The risk in moving away is letting the generator enumerate tools _independently_ of what actually registers.

The enabling fact: a tool's registration metadata is static. Nothing about `name`/`title`/`description`/`annotations`/`inputSchema` needs a constructed store, a client, or a session — only the _handler_ does. So the metadata can be exported as data and read without building anything.

## Decision

Make each tool **data + behavior**: `defineTool(spec, ctx => handler)` returns a `ToolDef` = `{ spec, register }`, where `spec` is `{ name, title, description, annotations, inputSchema }` (`src/kernel/tool.ts`). A module lists `ToolDef`s in `tools: [...]` exactly as before; the kernel registers each via `tool.register(ctx)`, which calls `server.registerTool(spec.name, spec, handler(ctx))`.

The generator then **imports the tool modules and reads `.spec`** — no kernel, no `McpServer`, no SDK internals. Discovery (glob `tools/*.ts`, import, collect `ToolDef`s) and rendering live in `scripts/tool-specs.ts`, shared with the guard tests so the generator and its checks see the surface identically. Tool files reference `module.ts` only via `import type`, so importing one triggers no module self-registration — discovery stays boot-free.

`inputSchema` keeps the two forms `registerTool` accepts — a raw shape, or a whole `.strict()` Zod object (where `.strict()` is load-bearing and `.shape` would discard it). `defineTool`'s generic threads that form to the handler's `args`, mirroring the SDK's own `registerTool` generic, so the split adds no casts of its own.

Two tests preserve what boot-introspection guaranteed, and add one more:

- **Drift** (`src/kernel/tool-reference.test.ts`): build every registered module and collect its tools' spec names; assert that set equals the globbed spec names. This pins "documented ⇔ registered" — no tool wired but undocumented, none documented but unwired.
- **Freshness**: assert the committed `README.md` equals `renderToolReference(collectToolSpecs())` — catches a forgotten `pnpm generate:tool-reference`, which no CI check previously covered.

Spec _content_ can't drift at all: the generator and the kernel read the **same** `spec` object (the tool file exports the `ToolDef`; `module.ts` imports it into `tools: [...]`; the generator imports it from the file). Only set-membership could differ, and the drift test pins that.

## Rejected alternatives

### Keep introspecting `_registeredTools` (the status quo)

Rejected: it is the source of all three problems — a private-field dependency that breaks silently on an SDK bump, a full boot for static data, and dropped `title`/`annotations`.

### The lighter interim — a capturing stub or a public "list specs" accessor on the kernel

Boot the kernel as today, but record specs through a fake server that captures each `registerTool(name, config)` (or expose a spec list off the kernel), so the generator stops touching `_registeredTools`. Rejected as the end state: it removes the SDK-internal dependency but **still boots the kernel** (and runs the doomed sync), so it only addresses one of three problems. It remains a reasonable fallback had the full refactor proven too costly; it did not — the conversion was mechanical and behavior-preserving.

### Make set-membership "by construction" too (central manifest or per-module exported tool arrays)

Have the generator read the exact registered set without a test — e.g. a central tool manifest, or hoist each module's `tools` array to a static export the generator imports. Rejected: a central list fights the kernel's deliberate "no central module list" (ADR-0009), and per-module static arrays add ceremony to every module. The drift test gives the same membership guarantee at the cost of one test that may boot — and tests are allowed to boot; only the generator isn't.

### `defineTool` returns `{ spec, handler }`, kernel calls `registerTool`

Keep the SDK `registerTool` call in the kernel's `registerAll` (`server.registerTool(t.spec.name, t.spec, t.handler(ctx))`) rather than inside `defineTool`. Rejected in favor of `{ spec, register }`: putting the call inside `defineTool` keeps the one site that touches `registerTool` fully generic (the schema↔handler link is checked there), so the kernel just calls `register(ctx): void` and needs no cast on an erased handler — matching the kernel's "all real safety at the injection site" stance.

## Consequences

**Positive**

- No dependency on SDK internals; an SDK bump can no longer silently break doc-gen.
- The generator reads static data — no kernel, no `McpServer`, no doomed sync.
- Richer output: `title` and the annotation hints (read-only / destructive / idempotent) now appear.
- Spec content cannot drift (generator and kernel share the object); membership and freshness are test-enforced, the latter closing a gap CI didn't cover.
- `defineTool` is a single, typed authoring seam for tools, consistent with `defineModule`.

**Negative**

- A cross-cutting convention change across all 58 tools and the kernel's tool type. Mitigated: the per-tool transform is mechanical (move the handler into a factory, lift the spec to data), behavior-preserving, and verified by the full suite plus typecheck.
- Set-membership is test-enforced, not by-construction: a `ToolDef` exported from a file but wired into no module's `tools: [...]` would be documented-but-unregistered. The drift test catches exactly this, but it is a test, not the compiler.
- The drift test boots the kernel (construction only, no sync). That is fine — the _generator_ must stay boot-free; its guard need not.

## References

- Issue [#230](https://github.com/bojanrajkovic/mcp-paprika/issues/230) — the decoupling task; parent [#228](https://github.com/bojanrajkovic/mcp-paprika/issues/228).
- [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) — the kernel and `defineModule` this mirrors for tools.
- `src/kernel/tool.ts` — `ToolSpec`/`ToolDef`/`defineTool`; `scripts/tool-specs.ts` — shared discovery + render; `scripts/generate-tool-reference.ts` — the thin writer; `src/kernel/tool-reference.test.ts` — the drift + freshness guards.
