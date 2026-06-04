import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export function textResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text }] } as const satisfies CallToolResult;
}

/**
 * Builds the "look up an entity by exact UID OR by a fuzzy text field" input
 * schema shared by read_recipe, read_grocery_list, and read_pantry_item. A
 * `z.union` of two `.strict()` objects dispatched by property presence — the
 * same shape (and the same rationale) as `mealTypeSpecSchema` in meal-helpers.
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
 * Renders a `LookupOutcome` to a `CallToolResult` with wording consistent
 * across the three lookup tools. `renderOne` produces the full single-entity
 * markdown; `disambiguationLine` produces one bullet of the multi-match list
 * (kept per-entity so each tool's existing line format is preserved).
 * `entityNoun` is the singular noun; the plural is `entityNoun + "s"`.
 */
export function formatLookupOutcome<T>(
  outcome: LookupOutcome<T>,
  config: { entityNoun: string; renderOne(entity: T): string; disambiguationLine(entity: T): string },
): CallToolResult {
  if (outcome.kind === "uid_hit" || outcome.kind === "text_one") {
    return textResult(config.renderOne(outcome.entity));
  }
  if (outcome.kind === "uid_miss") {
    return textResult(`No ${config.entityNoun} found with UID "${outcome.uid}".`);
  }
  if (outcome.kind === "text_none") {
    return textResult(`No ${config.entityNoun}s found matching "${outcome.text}".`);
  }
  const list = outcome.matches.map(config.disambiguationLine).join("\n");
  return textResult(
    `Multiple ${config.entityNoun}s match "${outcome.text}":\n${list}\n\nPlease re-invoke with a specific uid.`,
  );
}
