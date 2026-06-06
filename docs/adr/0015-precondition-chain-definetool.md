# ADR-0015: Precondition-chain `defineTool` (declarative tool gates + centralized logging)

**Status:** Accepted (2026-06-06)
**Last verified:** 2026-06-06
**Refines:** [ADR-0011](0011-tool-specs-as-data.md) (the `defineTool` authoring seam) · builds on [ADR-0014](0014-neverthrow-core-foreign-boundaries.md) (the `Result` guard shape)

## Context

After ADR-0014, every tool readiness gate is a `Result<void, CallToolResult>` — `ok` to proceed, `err` carrying the complete "still syncing" tool result. But the gate was **consumed inside each tool body**: ~44 tools wrapped their entire body in the ok arm of a `.match()`:

```ts
return async (args) => {
  log.info({ tool: "read_recipe", ...args.lookup }, "tool invoked");
  return recipeColdStartGuard(ctx.state).match(
    async (): Promise<CallToolResult> => {
      /* the whole body, one level deep */
    },
    (guard) => guard,
  );
};
```

Four costs, each multiplied across the surface:

- **Every gated body sits one nesting level deep** inside an ok arm whose error arm is always the identity `(guard) => guard`.
- **The gate's `.match()` is duplicated ~44×** — pure consumption ceremony with no per-tool variation.
- **"Tool invoked" logging is per-tool boilerplate** with drifting field shapes (`...args.lookup` here, `{ count }` there, nothing elsewhere), and nothing structurally guarantees it runs before the gate.
- **Multi-leg gates are half-named, half-inline**: the primary gate lives in `tools/guards.ts`, but a secondary leg (grocery-move's `pantry.hasSynced()` check, photo-writes' photo-catalog check) hides as an `if` inside the ok arm, invisible at the tool's head.

The enabling facts: the kernel already owns the one chokepoint every tool registration passes through (`defineTool`'s `register`, ADR-0011), and ADR-0014 already normalized every gate to the same `Result<void, CallToolResult>` shape. Folding identically-shaped gates at the shared chokepoint is the same move that built the kernel itself.

## Decision

Extend `defineTool` with an Express-middleware-style overload (`src/kernel/tool.ts`):

```ts
defineTool(spec, [pre1, pre2], (ctx) => handler);
```

where each entry is a `ToolPrecondition<Ctx> = (ctx: Ctx) => Result<void, CallToolResult>`. The kernel wraps **every** registered callback (both overloads) once:

1. logs `tool invoked` (uniform `{ tool }` shape, info) **before** the gate, so a gated call is still visible — plus the full `args` on a separate **debug** line, so per-call correlation (which UID, which list) is recoverable by raising the level without putting recipe-sized payloads in info logs;
2. runs the preconditions in order, short-circuiting on the first `err` — that err **is** the tool response, and the failing guard's function name is logged (`tool gated by precondition`, **debug**: gating is the expected, self-healing cold-start state, and a retrying client would otherwise storm the info log with one gate line per call across the whole surface);
3. calls the body.

The gate's `.match()` now lives once, in the kernel; tool bodies start flat.

**Guards declare the narrowest ctx slice they need** — `{ state: XState }` for a domain's own cold-start gate, a deps-bearing `DomainCtx` for a cross-domain gate (`scheduleMenuStartGuard`). Parameter contravariance lets any richer tool ctx flow into the narrower parameter, so one guard slots into every tool of its domain without per-tool adapters, and a former inline leg becomes one more named array entry (`[groceryStartGuard, pantrySyncedGuard]`).

**Inference is anchored on the handler annotation, and two traps are deliberate non-choices:**

- The precondition array is **not** wrapped in `NoInfer`. Contextually typing a context-sensitive array element fixes the generics **before** the handler argument is processed (arguments resolve left-to-right), collapsing `State` to `unknown`. With no `NoInfer`, the annotated handler factory — which is not context-sensitive — contributes its candidates in TS's first inference round, and the array is then checked against the settled ctx.
- **Precondition entries must be parameter-annotated functions** (named guards from `guards.ts`, or arrows with an annotated parameter). An unannotated inline arrow is context-sensitive and gets its parameter typed before the handler fixes the generics — the same collapse. The sweep's target form, `[namedGuard]`, never hits this; the constraint is documented at `defineTool`.

**Centralized logging is uniform by design.** The per-tool invoke logs' ad-hoc argument fields (`...args.lookup`, `{ count }`) leave the info line: the kernel logs the tool name identically for all 44+ tools, the kernel's debug `args` line covers per-call correlation (for the pure read tools, the invoke moment was their only log point), and a body that needs domain-relevant fields on an outcome logs them itself where they matter (as the write paths already do). Uniformity plus the gated-call log — which the per-tool form could silently omit or misplace — is worth more than inconsistent per-tool detail.

## Rejected alternatives

### Status quo — per-tool `.match()` nesting

Rejected: it is the four costs above. The kernel is already the single registration chokepoint; consuming an identically-shaped gate 44 times at the call sites instead of once at the chokepoint is duplication with no compensating flexibility (no tool ever varied the error arm).

### A `firstGuardError` early-return helper

`const gate = firstGuardError(guardA(ctx.state), guardB(ctx)); if (gate) return gate;` at the top of each body. Rejected: it flattens the nesting but keeps per-tool consumption and ordering as conventions — nothing enforces that the check runs before the body, that the invoke log precedes it, or that a new tool includes it at all. The kernel wrapper makes all three structural, and centralizes the logging the helper couldn't.

### `ResultAsync` pipelines — compose the body into the gate

`guard(ctx).asyncAndThen(() => body(args))` per tool, or a kernel that expects `ResultAsync<CallToolResult, CallToolResult>` bodies. Rejected: the SDK contract is `Promise<CallToolResult>` either way, and both channels would carry the _same_ success-shaped wire type — a `Result` whose ok and err are indistinguishable in kind adds rail ceremony without adding safety (ADR-0014 reserves `Result` for outcomes that differ in kind). It would also rewrite all 44 bodies instead of flattening them.

### Preconditions on the spec

`spec.preconditions: [...]` rather than a separate argument. Rejected: `spec` is serializable registration **data** the doc generator reads without booting anything (ADR-0011); guards are ctx-consuming **behavior**. Mixing them would put closures on the object the generator imports and re-couple the data/behavior split that ADR deliberately made.

## Consequences

**Positive**

- The ~44 gated tool bodies go flat — the ok-arm indentation and the identity error arm disappear; a tool's gates are visible at its head as a declarative list.
- Invoke + gate observability is structural: every tool logs `tool invoked` identically, every gated call logs the failing guard's name, and neither can be forgotten or misordered by a new tool.
- Multi-leg gates become named, reusable guards; "what must be true to run this tool" reads off the array.
- A tool with no gate keeps the two-arg form and still gains the centralized invoke log.

**Negative**

- The kernel wrapper needs an erased-callback bridge (`ErasedToolCallback`): `ToolCallback<I>` is a deferred conditional over a generic `I`, so the wrapper flows through `(args, extra) => …` and re-asserts the SDK type at the `registerTool` edge. Same budget and rationale as `defineModule`'s single `ErasedModule` cast (ADR-0009 §1) — the authoring surface stays fully checked.
- The annotated-entry constraint is a real sharp edge: an unannotated inline arrow in the array fails inference with a confusing `unknown`-typed ctx. Mitigated by the documented constraint and by the target idiom being named guards.
- Info-level invoke logs lose per-tool argument fields. The kernel's debug `args` line recovers per-call correlation when an operator needs it, and bodies that need outcome fields log them; the trade is uniformity (and the previously-impossible gated-call visibility) for always-on ad-hoc detail.

## References

- Issue [#266](https://github.com/bojanrajkovic/mcp-paprika/issues/266) — this decision; campaign [#241](https://github.com/bojanrajkovic/mcp-paprika/issues/241), parent [#228](https://github.com/bojanrajkovic/mcp-paprika/issues/228).
- [ADR-0011](0011-tool-specs-as-data.md) — the `defineTool` data/behavior seam this extends.
- [ADR-0014](0014-neverthrow-core-foreign-boundaries.md) — the `Result<void, CallToolResult>` guard shape the chain folds.
- `src/kernel/tool.ts` — `ToolPrecondition`, the overloads, the gate wrapper; `src/kernel/tool.test.ts` — ordering, short-circuit, and logging coverage.
