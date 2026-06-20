import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Result } from "neverthrow";
import { z } from "zod";

import type { ElicitationServer } from "./elicit.js";

import { confirmGate, pickOne } from "./elicit.js";

/**
 * The MCP wire envelope every tool returns. The one-argument form carries only
 * the human-readable text block; the two-argument form additionally carries a
 * `structuredContent` record on MCP's parallel structured channel — clean prose
 * for the person, machine identifiers for the model driving the next call (and,
 * later, a `ui://` widget's data). The text block is always present: MCP has no
 * structured-only result, so this augments `content`, it does not replace it.
 *
 * A tool that returns the two-argument form must also declare an `outputSchema`
 * on its `ToolSpec`. That coupling runs both ways at the SDK boundary: once a
 * schema is declared the SDK requires `structuredContent` on every non-error
 * result and validates it against the schema (an error result is exempt), so a
 * schema-bearing tool returns the two-argument form on all of its success
 * branches. `S extends Record<string, unknown>` matches the SDK's record-typed
 * `structuredContent`, so a list read wraps its rows as `{ items: [...] }`
 * rather than a bare array.
 */
export function toolResult(text: string): { content: [{ type: "text"; text: string }] };
export function toolResult<S extends Record<string, unknown>>(
  text: string,
  structuredContent: S,
): { content: [{ type: "text"; text: string }]; structuredContent: S };
export function toolResult(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return structuredContent === undefined
    ? ({ content: [{ type: "text" as const, text }] } satisfies CallToolResult)
    : ({ content: [{ type: "text" as const, text }], structuredContent } satisfies CallToolResult);
}

/**
 * The error envelope: a text-only result flagged `isError`, carrying NO
 * `structuredContent`. The split from {@link toolResult} mirrors the SDK's own
 * contract — once a tool declares an `outputSchema`, the SDK's `validateToolOutput`
 * requires valid `structuredContent` on every NON-error result but returns early on
 * an error one. So a schema-bearing tool returns this on the branches that are not a
 * successful answer — a precondition gate that is not yet ready, an unknown UID, an
 * unparseable argument — without fabricating a schema-valid payload for a non-result,
 * and the friendly text + remediation hint survives intact instead of being replaced
 * by the validator's generic schema error. That keeps "found nothing" (a real empty
 * success — `toolResult(text, { items: [] })`) distinct from "your input was wrong /
 * I am not ready" (this), which the model must not parse as data. Pure construction,
 * no throw (ADR-0019; the contract is pinned in `src/kernel/tool.e2e.test.ts`).
 */
export function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text" as const, text }], isError: true } satisfies CallToolResult;
}

/**
 * Run a {@link confirmGate} as a destructive-tool guard. Returns the cancel
 * `CallToolResult` to return as-is when the user DECLINES the confirm, or
 * `undefined` to proceed — both on accept and, fail-open, when the client cannot
 * be elicited (ADR-0020). Keeps a gated handler to two lines at the point of the
 * irreversible act: `const stop = await confirmOrCancel(ctx.server.server, {…}); if (stop) return stop;`.
 * The `message` names the entity (and, for a bulk act, the count); `cancelled`
 * is the plain acknowledgement that nothing was changed (never an `isError`).
 */
export async function confirmOrCancel(
  server: ElicitationServer,
  opts: { readonly message: string; readonly cancelled: string },
): Promise<CallToolResult | undefined> {
  return (await confirmGate(server, { message: opts.message })) === "declined" ? toolResult(opts.cancelled) : undefined;
}

/**
 * A result carrying the human text PLUS a JPEG image content block (ADR-0019 R2 —
 * image content blocks). MCP's `content` array holds multiple blocks, so the person
 * sees the rendered image inline — e.g. the thumbnail just attached to or generated for
 * a recipe — instead of confirming a photo landed from prose alone. The bytes are
 * inlined as base64; callers pass a small normalized JPEG thumbnail (the full image
 * stays server-side). Pure construction, no throw.
 */
export function imageResult(text: string, jpeg: Buffer): CallToolResult {
  return {
    content: [
      { type: "text" as const, text },
      { type: "image" as const, data: jpeg.toString("base64"), mimeType: "image/jpeg" },
    ],
  } satisfies CallToolResult;
}

/**
 * Consume a commit chokepoint's `Result` in a write tool: `undefined` when the
 * commit landed, or the uniform "persisted to Paprika, local commit failed"
 * response to return as-is. The two-line guard —
 * `const commitErr = commitFailure("recipe", await ctx.writes.commitX(saved));
 * if (commitErr) return commitErr;` — keeps the tool's success tail flat.
 *
 * The wording is deliberate: by the time a chokepoint runs, the Paprika POST
 * already succeeded, so a failure here is LOCAL divergence (cache/store).
 * Telling the agent the write itself failed would invite a harmful retry (a
 * duplicate write). HOW the divergence resolves differs by sync strategy:
 * replace-all entities genuinely reload every cycle (`selfHealing` default),
 * but recipes sync by diffing the hash index that `RecipeDiskCache.put()`
 * already advanced before the failed flush — the next diff believes the local
 * copy is current, so a recipe's tools pass `selfHealing: false` and the
 * message stops promising a repair the diff cannot deliver.
 *
 * A schema-bearing write tool (B1/#321) passes `structuredContent` — built from the
 * just-saved entity, which is in hand even when the local flush failed — so this
 * degraded branch stays a valid NON-error success under a declared `outputSchema`.
 * The SDK requires `structuredContent` on every non-error result, and the write did
 * land on Paprika; marking it `isError` would wrongly read as a failed write and
 * invite the harmful retry the message warns against. Non-schema callers omit it and
 * are unchanged.
 */
export function commitFailure(
  entity: string,
  result: Result<void, { readonly message: string }>,
  opts: { readonly selfHealing?: boolean; readonly structuredContent?: Record<string, unknown> } = {},
): CallToolResult | undefined {
  const tail =
    (opts.selfHealing ?? true)
      ? "the local view will correct itself on the next sync."
      : "the local copy may remain stale until it next changes on the server or the server restarts — " +
        "the change itself is already saved, so do not re-submit it.";
  return result.match(
    () => undefined,
    (e) => {
      const text = `The change was saved to Paprika, but updating the local ${entity} cache failed (${e.message}); ${tail}`;
      return opts.structuredContent ? toolResult(text, opts.structuredContent) : toolResult(text);
    },
  );
}

/**
 * Builds the "look up an entity by exact UID OR by a fuzzy text field" input
 * schema shared across the uid-or-text lookup tools — the `read_*` reads and the
 * menu/grocery action tools that resolve an entity by name (the callers of
 * `resolveLookup`). A `z.union` of two `.strict()` objects dispatched by property
 * presence — the same shape (and the same rationale) as `mealTypeSpecSchema` in
 * meal-helpers.
 *
 * The UID member is branded (e.g. `RecipeUidSchema`), so `args.lookup.uid` is
 * already brand-typed after parse — no cast at the store lookup. The text key
 * stays per-entity (`title` / `ingredient` / `name`) because each is the
 * accurate label for its entity. The text-member description defaults to a
 * template built from `entityLabel`/`textKey`/`textExample`; pass `textDescribe`
 * to override it verbatim when the template reads awkwardly (e.g. pantry, whose
 * natural phrasing is "Ingredient name fuzzy match", not "Pantry item ingredient
 * fuzzy match").
 */
export function uidOrTextLookupSchema<UidSchema extends z.ZodTypeAny, TextKey extends string>(config: {
  readonly uidSchema: UidSchema;
  readonly textKey: TextKey;
  readonly entityLabel: string;
  readonly textExample?: string;
  readonly textDescribe?: string;
}) {
  const { uidSchema, textKey, entityLabel, textExample, textDescribe } = config;
  const capitalized = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
  const uidMember = z.object({ uid: uidSchema }).strict().describe(`Exact ${entityLabel} UID, e.g. {"uid": "..."}.`);
  const textMember = z
    .object({ [textKey]: z.string().min(1) } as { [P in TextKey]: z.ZodString })
    .strict()
    .describe(textDescribe ?? `${capitalized} ${textKey} fuzzy match, e.g. {"${textKey}": "${textExample}"}.`);
  return z.union([uidMember, textMember]).describe(`Pick exactly one shape: {"uid": "..."} or {"${textKey}": "..."}.`);
}

/**
 * Normalized lookup query a caller derives from a `uidOrTextLookupSchema`
 * value: it does the type-safe `"uid" in lookup` narrowing against its own
 * concrete text key, then hands `resolveLookup` a uniform `{uid}|{text}` so
 * the resolver never needs to know the per-entity key name.
 */
export type LookupQuery<U extends string> = { readonly uid: U } | { readonly text: string };

/**
 * Structured outcome of a uid-or-text lookup. Mirrors `MealTypeResolveResult`:
 * the resolver classifies, callers format. `text_many` carries the matches so
 * the caller can render its own disambiguation lines.
 */
export type LookupOutcome<T> =
  | { readonly kind: "uid_hit"; readonly entity: T }
  | { readonly kind: "uid_miss"; readonly uid: string }
  | { readonly kind: "text_none"; readonly text: string }
  | { readonly kind: "text_one"; readonly entity: T }
  | { readonly kind: "text_many"; readonly text: string; readonly matches: ReadonlyArray<T> };

/**
 * Resolves a normalized lookup query against an entity store's `get` (exact,
 * branded UID) and `findByText` (fuzzy, 0/1/many) operations. Never formats
 * user-facing text — see `formatLookupOutcome`.
 */
export function resolveLookup<T, U extends string>(
  query: LookupQuery<U>,
  ops: { get(uid: U): T | undefined; findByText(text: string): ReadonlyArray<T> },
): LookupOutcome<T> {
  if ("uid" in query) {
    const entity = ops.get(query.uid);
    return entity === undefined ? { kind: "uid_miss", uid: query.uid } : { kind: "uid_hit", entity };
  }
  const matches = ops.findByText(query.text);
  if (matches.length === 0) return { kind: "text_none", text: query.text };
  if (matches.length === 1) return { kind: "text_one", entity: matches[0]! };
  return { kind: "text_many", text: query.text, matches };
}

/**
 * Default ceiling on a `text_many` PICK: above it an enum is an unusable picker,
 * so the disambiguation prose is shown instead of an elicitation (ADR-0020).
 */
const PICK_CAP = 8;

/**
 * Resolve a `LookupOutcome` to the single entity to act on, OR the terminal
 * `CallToolResult` to return as-is — the shared narrow-or-terminate step every
 * uid-or-text tool runs. The happy arms (`uid_hit` / `text_one`) yield
 * `{ entity }`. Every non-happy arm leaves the SUCCESS channel as an
 * `errorResult` (isError, no `structuredContent`): `uid_miss` / `text_none`
 * return a not-found message carrying the `findWith` remediation hint — the
 * discovery verb that resolves the miss (ADR-0008) — so a schema-bearing caller
 * (B1/#321) stays valid and the model never parses a "not found" as data.
 * `text_many` first offers a rung-3 disambiguation PICK (ADR-0020) when the match
 * set fits under `cap`, proceeding with the chosen entity on accept; a decline,
 * an un-elicitable client, or an over-cap set fall back to an `isError`
 * disambiguation list the caller can re-query from. `describe` maps an entity to
 * the picker's opaque-UID value and its human label (also the bullet's label), so
 * the PICK and the wording stay identical across the lookup tools.
 */
export async function resolveOrPick<T>(
  server: ElicitationServer,
  outcome: LookupOutcome<T>,
  config: {
    readonly entityNoun: string;
    readonly describe: (entity: T) => { readonly uid: string; readonly label: string };
    readonly findWith?: string;
    readonly cap?: number;
  },
): Promise<{ readonly entity: T } | { readonly result: CallToolResult }> {
  if (outcome.kind === "uid_hit" || outcome.kind === "text_one") return { entity: outcome.entity };

  // Every non-happy arm leaves the SUCCESS channel as an errorResult (isError, no
  // structuredContent), so a schema-bearing caller (B1/#321) stays valid and the
  // model never parses a "not found" as data. `findWith` names the discovery verb
  // that resolves the miss (ADR-0008); the seam owns the sentence so the wording
  // stays uniform across tools.
  const findHint = config.findWith
    ? ` Use ${config.findWith} to find it.`
    : " Supply an exact UID, or look it up by name.";
  if (outcome.kind === "uid_miss") {
    return {
      result: errorResult(
        `No ${config.entityNoun} found with UID "${outcome.uid}" (it may not exist or was already deleted).${findHint}`,
      ),
    };
  }
  if (outcome.kind === "text_none") {
    return { result: errorResult(`No ${config.entityNoun}s found matching "${outcome.text}".${findHint}`) };
  }
  if (outcome.matches.length <= (config.cap ?? PICK_CAP)) {
    const picked = await pickOne(server, {
      message: `More than one ${config.entityNoun} matches "${outcome.text}". Which one did you mean?`,
      candidates: outcome.matches,
      describe: config.describe,
    });
    if (picked !== "declined" && picked !== "unsupported") return { entity: picked.chosen };
  }
  const lines = outcome.matches
    .map((entity) => {
      const { uid, label } = config.describe(entity);
      return `- **${label}** (uid: \`${uid}\`)`;
    })
    .join("\n");
  return {
    result: errorResult(
      `Multiple ${config.entityNoun}s match "${outcome.text}":\n${lines}\n\nRe-invoke with a specific uid.`,
    ),
  };
}

/**
 * Render a `LookupOutcome` to a `CallToolResult` for the read tools: a resolved
 * entity (including one chosen via the {@link resolveOrPick} PICK) renders
 * through `renderOne`; every not-found / disambiguation path returns the shared
 * `errorResult` (isError) with its remediation hint. `entityNoun` is the singular
 * noun; the plural is `entityNoun + "s"`.
 *
 * A schema-bearing read (B1/#321) passes `renderStructured` to additionally emit
 * `structuredContent` on the happy arm — derived from the SAME resolved entity that
 * `renderOne` formats, so the text and the structured payload agree by construction.
 * Only the SUCCESS arm carries it; every non-happy arm stays an `errorResult` with no
 * `structuredContent` (already so from A2), so a schema-bearing caller's success
 * channel is the only path the SDK's `validateToolOutput` checks (ADR-0019). Per-tool
 * payload typing lives at the call site (one Zod schema derives both the mapper's
 * return type and the declared `outputSchema`); the `Record<string, unknown>` bound
 * only erases it here.
 */
export async function formatLookupOutcome<T>(
  server: ElicitationServer,
  outcome: LookupOutcome<T>,
  config: {
    readonly entityNoun: string;
    readonly describe: (entity: T) => { readonly uid: string; readonly label: string };
    readonly renderOne: (entity: T) => string;
    readonly renderStructured?: (entity: T) => Record<string, unknown>;
    readonly findWith?: string;
    readonly cap?: number;
  },
): Promise<CallToolResult> {
  const resolved = await resolveOrPick(server, outcome, config);
  if (!("entity" in resolved)) return resolved.result;
  const text = config.renderOne(resolved.entity);
  return config.renderStructured ? toolResult(text, config.renderStructured(resolved.entity)) : toolResult(text);
}
