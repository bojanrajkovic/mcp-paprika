# ADR-0025: Externalize the widget vendor runtime (transport-conditional self-host + import map)

**Status:** Accepted (2026-06-27)

## Context

[ADR-0019](0019-mcp-app-widget-surface.md) compiled each widget into one self-contained HTML string with the `@modelcontextprotocol/ext-apps` browser runtime (ext-apps + the MCP SDK + zod) inlined alongside the Svelte bundle. That kept a widget a standalone artifact — the sandboxed iframe fetched nothing, and the apps SDK stayed a build-time-only devDependency the runtime only ever read as a string. But that runtime is ~329 KB (~77 KB gz) and **byte-identical across all seven widgets**, so a multi-widget session re-ships the same blob every render: cold all-seven was ~753 KB gz, ~77 KB of every widget the same inlined runtime.

Two things changed the constraint. The S0 spike (2026-06-27) confirmed the host honors `_meta.ui.csp.resourceDomains` on the served UI **resource** content item (`csp` is resource meta — `McpUiToolMeta.csp` is typed `never`), mapping an allowlisted origin into the iframe CSP's `script-src`/`style-src`/`img-src`/`font-src`/`media-src` (not `connect-src`). So an externalized script from an allowlisted origin loads — the inlining was a constraint we no longer have. And the 0a render attribution found bundle size is **dead as a latency lever** (the render gap is proxy round-trips, not transfer), so this is a **cleanliness and transfer-weight** change, not a speed one: stop shipping the same 329 KB seven times.

The widget bundle was an IIFE for one reason only: it shared a single inline `<script type="module">` scope with the inlined runtime, where two ESM top-level name sets would collide. Externalizing the runtime into its own `<script>` removes that scope sharing — which is what makes the IIFE→ESM flip safe, so the two are one coupled change.

## Decision

**Externalize the runtime as one shared, content-hashed vendor module, resolved by an import map.**

- Each widget bundle keeps a bare `import … from "@modelcontextprotocol/ext-apps"` (esbuild `external`), built as **ESM** (the IIFE is no longer needed) and **fully minified** (env-gated off for `pnpm dev:widgets`). The build emits ONE `dist/widgets/vendor-<hash>.js` — ext-apps' pre-bundled `app-with-deps` copied verbatim — content-hashed and pre-compressed (brotli-11 + gzip).
- The serving layer fills a vendor slot in the HTML with a `<script type="importmap">` that points the bare specifier at the vendor, **transport-conditionally**:
  - **HTTP** — a self-hosted, unauthenticated, `immutable`-cached route serves `vendor-<hash>.js` (negotiating brotli/gzip); the import map targets `{MCP_PUBLIC_URL-origin}/widgets/vendor-<hash>.js`, and the served content item carries `_meta.ui.csp.resourceDomains = [origin]` so the host allowlists it for `script-src`. The iframe fetches it once and caches it across every widget and session.
  - **stdio** — no HTTP server on a local pipe, so the import map targets an inline `data:text/javascript;base64,…` URL of the vendor bytes: self-contained and offline, exactly like the old inlined runtime.

**Self-hosted, not a CDN.** The vendor is served from our own origin: no third-party runtime dependency, the version is exactly what we built and tested (the content hash IS the version), the iframe's CSP names only our origin, and we own the caching. The caching win is identical to a CDN's — a content-hashed, `immutable` GET cached in the user's browser.

ext-apps stays a build-time-only devDependency: the value import lives ONLY in the esbuild-compiled browser bundles (`mount-widget.ts`, `shared/host-style.ts` — excluded from the Node `tsc` graph), never the Node runtime path, and the vendor file is ext-apps' own pre-bundled output copied verbatim. The `prod-widgets` gate (`scripts/verify-prod-widgets.mjs`) stays the hard proof — its check flips from "the runtime is inlined" to "the runtime is externalized (a bare import, never inlined) and one shared vendor file exists."

## Rejected alternatives

### Keep inlining (status quo)

Rejected: it re-ships the identical 329 KB runtime in every widget, so a multi-widget session has no cross-widget cache and pays the full weight per render. The CSP path that makes externalization safe is now confirmed (S0), so the original reason to inline (the iframe could fetch nothing) is gone.

### Serve the vendor from a CDN (jsdelivr)

Rejected: it saves the ~15-line self-hosted route but adds a **third-party runtime dependency** (a jsdelivr outage breaks every widget), a third-party origin in the iframe's CSP, and a version-sync guard whose cost ≈ the route it saves — while the caching win is identical to self-hosting (the same content-hashed, immutable GET). It also forces consuming the CDN's file as-is (no control over the served bytes). The third-party coupling isn't worth a route we can write once.

### Keep the `globalThis.ExtApps` global seam (split-script, no import map)

Rejected (a closer call): splitting the inlined runtime into its own classic `<script>` that sets `globalThis.ExtApps` — which `mount-widget`/`host-style` already read — would be a smaller diff and need no import map or CORS. But the import-map seam binds the widgets to the runtime through a real ES `import` (the ecosystem's MCP-apps pattern), removing the global and the manual `globalThis` reads, at the cost of churn in `mount-widget`, `host-style`, and the preview shim. Chosen after weighing the cleaner seam against the larger diff.

### Externalize on stdio too (point the import map at a remote URL)

Rejected: it would unify the two transports on one URL, but make local/desktop widgets depend on the network and abandon offline rendering — a real regression on the transport where it matters least to externalize (a local pipe has no transfer cost). stdio inlines via a `data:` URL instead.

## Consequences

**Positive**

- A multi-widget session ships the 329 KB runtime ONCE (`immutable`-cached): cold all-seven ~753 → ~283 KB gz (~63% cut, brotli vendor), per-widget ~120 → ~31 KB gz, and every widget past the first pays **zero** for the vendor (a pure cache hit, no revalidation).
- Brotli/gzip are pre-built at content-hash time, so the route serves ~60 KB (br) with zero per-request compression CPU, independent of any proxy in front.
- The IIFE→ESM flip and full minification fall out for free (the runtime no longer shares the widget's script scope), and the dev build stays readable (env-gated minify).

**Negative**

- A single-widget session pays one extra request (the vendor fetch) versus the old inline — acceptable, and cached for every later widget and session.
- The HTTP transport gains a new public, unauthenticated static-asset route — but it exact-matches the content-hashed filename (no path traversal, no arbitrary `dist/` read) and serves only ext-apps' public runtime (no secret).
- The dev preview shim is now an ESM module delivered through a `data:`-URL import map rather than a `globalThis.ExtApps` classic script; its surface stays pinned by `SHIMMED_HOST_METHODS` / `SHIMMED_EXTAPPS_HELPERS`.
- stdio's served HTML is larger (the base64 `data:` URL is ~33% over the raw bytes), but it crosses a local pipe with no wire — immaterial.

## References

- [ADR-0019](0019-mcp-app-widget-surface.md) — the widget surface this evolves; its inlining note is amended to point here.
- [ADR-0018](0018-opentelemetry-instrumentation.md) — the telemetry substrate whose 0a render attribution reframed this as cleanliness-only (the render gap is proxy round-trips, not transfer).
- The widget-delivery epic plan (Epic A / A1 + A2) and the S0 CSP `resourceDomains` spike result.
- External: the Model Context Protocol apps/UI surface (`_meta.ui.csp` on a UI resource) and the `@modelcontextprotocol/ext-apps` `app-with-deps` runtime.
