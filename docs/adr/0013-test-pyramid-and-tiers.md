# ADR-0013: Test tiers, the module-integration harness, and structure-driven vitest projects

**Status:** Accepted (2026-06-05)
**Related:** [ADR-0006](0006-test-fixtures-out-of-src.md) (colocated tests + the `test/` support tree), [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) (the kernel the harness builds)

## Context

After the composition-kernel migration the suite holds two different kinds of "unit" test under one suffix. Some exercise a single unit in isolation — a store constructed directly, a markdown formatter, a Zod schema, a sync reconcile against a mock client. Others exercise a tool or resource through `useKernelHarness`, which builds the module under test plus its declared-dependency closure against a test `Infra`, opens each module's real on-disk cache under an isolated temp dir, registers the root module's tools on a stub server, and seeds the built stores directly. The harness deliberately does **not** run sync — a seeded store stands in for a synced one.

Integration and e2e tests carry their own suffixes (`*.test.integration.ts`, `*.e2e.test.ts`) but run inline with everything else under a single `pnpm test`, and nothing in the runner surfaces the tiering: a run cannot tell you, at a glance, which tests crossed the real transport or booted the real kernel. One of those suffixes was also applied loosely — a full-MCP-SDK-over-stdio test named `*.test.integration.ts`, even though it crosses the real transport and is therefore an e2e test, not an integration one.

Two pressures bear on the design. First, the harness boots a real kernel for what is nominally a unit test, raising whether a tool test should instead run against a faked `DomainCtx`. Second, the tiers are invisible in a run. Three facts bound the choice: the whole suite finishes in about seven seconds; the parts the harness is "too heavy" to be a unit test of — stores, caches, syncs, the registry — already have focused pure-unit tests beneath it; and the real-dependency wiring a tool test gets from the harness (a sibling's actual contract reached through `ctx.deps`) is fidelity a hand-written fake would forfeit.

## Decision

**Four named tiers, mapped onto the existing file suffixes:**

- **Pure unit** (`*.test.ts`, no harness) — one unit in isolation: a store, a helper, a schema, a sync against a mock client. No kernel, no transport.
- **Module-integration** (`*.test.ts`, via `useKernelHarness`) — a module plus its dependency closure plus real caches, with **no sync** and **no transport**, driven through `callTool`. Tool and resource tests live here. This is an accepted tier, not a unit-test smell.
- **Integration** (`*.test.integration.ts`) — several real subsystems short of the wire: the real `buildKernel` running its boot sync against mocked HTTP, and cold-start disk persistence.
- **E2E** (`*.e2e.test.ts`) — crosses the real transport or process boundary: the MCP SDK over stdio against a spawned server, and the HTTP transport with the full OAuth flow.

An **external** sub-tier (`*.external.test.ts`) isolates a test that needs a live external service — the embeddings test against a local Ollama — which self-skips when the service is absent. Property tests (`*.property.test.ts`) are orthogonal and run within the unit tier.

**The tiers become first-class vitest projects** (`unit` / `integration` / `e2e` / `external`) so a run reports them separately. This is motivated by structural legibility, **explicitly not by runtime cost** — the suite is fast and nothing is gated for speed. `pnpm test` runs every project and stays the single pre-push and CI gate; per-tier scripts exist only for focused local runs.

**Tool and resource tests stay on the harness** — they are not migrated to a faked `DomainCtx`. What changes is the name: the "unit" label is retired for them in favor of "module-integration." The choice beats the field because the cost argument for isolating the harness is absent at a seven-second suite, the value the harness adds is real sibling contracts and real caches that a fake would drop, and the kernel parts the harness incidentally touches are already unit-tested directly — so the honest correction is to name the tier and make the tiers visible, not to rebuild the tool-test seam.

## Rejected alternatives

### Faked-`DomainCtx` unit tier — migrate tool tests off the harness

Give each tool test a hand-built `ctx` (real in-memory stores, spy writes, faked sibling APIs) and demote the full-kernel harness to a thin bootstrap tier. Rejected because it would trade real cross-domain wiring for fakes that drift from the contracts they stand in for — the precise integration bugs the harness catches (a tool calling a sibling's real `api`) would go unobserved — while paying to migrate every tool test, to buy an isolation the seven-second suite never needed.

### Hybrid — faked ctx for leaf domains, harness for cross-domain tools

Use the light faked ctx where a domain has no dependencies and keep the harness only where real deps matter. Rejected because it institutionalizes two tool-test patterns and forces a recurring "which seam?" judgment on every new test, for a saving the runtime does not demand.

### Flat single `include` — no projects

Keep one runner config and let the suffixes be documentation only. Rejected because the tiers then stay invisible in a run — the exact at-a-glance legibility this decision exists to provide.

### Separate gated integration tier — its own command or CI job

Split the integration tests behind a distinct gate so the main run stays "fast." Rejected because it presumes a per-run cost that does not exist: the suite is fast and the one network-dependent test already self-skips, so a gate would add ceremony without removing a cost.

## Consequences

**Positive**

- A run reports `[unit]` / `[integration]` / `[e2e]` / `[external]` separately, so what crossed the wire or booted the real kernel is legible without reading the files.
- A file's suffix now names its tier and routes it to a project; a misnamed file lands in the wrong project, which the convention makes visible rather than silent.
- The unit-versus-integration line is settled and documented: stores, caches, and syncs are pure unit; tool and resource tests are module-integration; full-kernel boot with sync is integration; transport and OAuth are e2e.
- `pnpm test` runs every project, so no tier silently drops out of the gate.

**Negative**

- "Unit" no longer means "fast and isolated" uniformly — the unit project contains module-integration tests that boot a module closure and real caches. The distinction lives in the docs and the harness's role, not in the filename.
- A tool test can fail because an unrelated dependency module's construction throws — coupling the harness accepts in exchange for real-dependency fidelity. It is a rare and usually useful smoke signal, but it is real.
- The runner now carries a projects config and four entry scripts where a single `include` sufficed.

## References

- Issues [#231](https://github.com/bojanrajkovic/mcp-paprika/issues/231) (tier structure + kernel-harness overlap) and [#239](https://github.com/bojanrajkovic/mcp-paprika/issues/239) (hygiene sweep); umbrella [#228](https://github.com/bojanrajkovic/mcp-paprika/issues/228).
- Related: [ADR-0006](0006-test-fixtures-out-of-src.md) (fixtures out of `src/`, colocated tests), [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) (the kernel and the `state`/`writes`/`deps`/`infra` ctx the harness wires).
- Layout + tier guide: `test/CLAUDE.md`; human workflow: `CONTRIBUTING.md` (Testing).
