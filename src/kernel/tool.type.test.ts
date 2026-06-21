/**
 * Compile-time (type-level) contract for {@link defineTool}'s schema-bearing handler
 * constraint.
 *
 * `tool.e2e.test.ts` pins the RUNTIME half — the SDK's `validateToolOutput` rejecting a
 * non-error result with no `structuredContent` over the real transport. This file pins the
 * COMPILE-TIME half: once a tool declares an `outputSchema` (so `O` is a concrete record
 * type), the handler's return type is `TypedCallToolResult<O>`, which makes returning a
 * bare `toolResult(text)` — or calling `commitFailure` without `structuredContent` and
 * returning its result — a type error. The `@ts-expect-error` markers below FAIL the build
 * if that enforcement ever regresses: an unused/ineffective `@ts-expect-error` is itself a
 * compile error, so `pnpm typecheck` (the real gate — this file sits under
 * `tsconfig.test.json`'s include) breaks the moment the guard stops catching one of these.
 * The `.test.ts` suffix also lets vitest collect the module so it is part of the normal run;
 * the single `it` has no runtime assertions because the contract is entirely compile-time.
 */

import { describe, it } from "vitest";
import { z } from "zod";

import type { DomainCtx } from "./registry.js";

import { commitFailure, toolResult } from "../shared/tools.js";
import { defineTool } from "./tool.js";

const outputSchema = z.object({ echoed: z.string() });

describe("defineTool — schema-bearing handler return-type guard (compile-time)", () => {
  it("is enforced at the type level (no runtime body)", () => {
    // POSITIVE: a schema-bearing handler that returns a success result carrying
    // structuredContent: O compiles cleanly.
    defineTool(
      {
        name: "ok_structured",
        title: "OK (structured)",
        description: "Returns a structured payload — satisfies TypedCallToolResult<O>.",
        annotations: { readOnlyHint: true },
        inputSchema: { query: z.string() },
        outputSchema,
      },
      (_ctx: DomainCtx<unknown, never>) => (args) => toolResult(`echo:${args.query}`, { echoed: args.query }),
    );

    // NEGATIVE 1: a schema-bearing handler that returns a bare toolResult(text) — no
    // structured payload — must NOT compile (the success branch lacks structuredContent: O).
    defineTool(
      {
        name: "bad_bare_text",
        title: "Bad (bare text)",
        description: "Returns bare toolResult(text) under a declared outputSchema — a type error.",
        annotations: { readOnlyHint: true },
        inputSchema: { query: z.string() },
        outputSchema,
      },
      // @ts-expect-error a schema-bearing handler may not return a structuredContent-less result
      (_ctx: DomainCtx<unknown, never>) => (args) => toolResult(`echo:${args.query}`),
    );

    // NEGATIVE 2: returning the result of `commitFailure` called WITHOUT structuredContent
    // (the untyped overload, return type CallToolResult) from a schema-bearing handler must
    // NOT compile — that is the exact regression this guard exists to catch.
    defineTool(
      {
        name: "bad_commit_no_structured",
        title: "Bad (commitFailure no structuredContent)",
        description: "Returns commitFailure(...) with no structuredContent under a declared outputSchema.",
        annotations: { readOnlyHint: false },
        inputSchema: { query: z.string() },
        outputSchema,
      },
      // @ts-expect-error commitFailure without structuredContent returns CallToolResult, not TypedCallToolResult<O>
      (_ctx: DomainCtx<unknown, never>) => (args) => {
        const ce = commitFailure("entity", { isErr: () => false, isOk: () => true } as never, {});
        return ce ?? toolResult(`echo:${args.query}`, { echoed: args.query });
      },
    );
  });
});
