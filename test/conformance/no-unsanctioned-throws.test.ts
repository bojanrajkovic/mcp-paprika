import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ADR-0014 conformance — code we own returns `Result` and never throws to signal
 * a predictable outcome. This walks every `src` source file (AST, so comments
 * don't count) for `throw` statements and fails any that is neither a recognized
 * form nor an entry on the ratcheting allowlist below.
 *
 * The allowlist was the neverthrow campaign's visible, shrinking surface (#241)
 * and is now EMPTY: every recognized form (#1–#5) has a recognizer, and every
 * remaining `throw` in `src/` is one of them. A new entry requires a tracked
 * issue naming the phase that removes it — and should be treated as a real
 * architectural question, not a quiet addition (ADR-0014).
 */

// Recognized forms #1 + #2 + #4: the helper bodies whose `throw` IS the
// sanctioned boundary crossing. Pinned to (file, function) so a same-named
// helper added elsewhere can't silently sanction its own throws. `unwrapOAuth`
// is form #2's Result→throw crossing onto the SDK's authorization-server rail.
const RECOGNIZED_HELPERS: ReadonlyArray<readonly [file: string, fn: string]> = [
  ["src/utils/errors.ts", "assertNever"],
  ["src/utils/errors.ts", "unwrapAtBoot"],
  ["src/shared/resources.ts", "resourceNotFound"],
  ["src/auth/errors.ts", "unwrapOAuth"],
];

// Recognized form #2: the OAuth error types the SDK's authorization-server
// router serializes into spec-compliant responses, thrown directly where the
// SDK's throw-based contracts (`OAuthServerProvider`, the DCR handler) are
// implemented. Matched by THROWN CONSTRUCTOR NAME, pinned to the two files
// that implement those contracts (the same discipline as the other
// recognizers — `src/auth/` has request-serving siblings like routes.ts that
// must NOT inherit the waiver). A non-OAuth throw in the same methods still
// fails the gate, and the Result→throw crossings ride the recognized
// `unwrapOAuth` helper instead.
const OAUTH_PROTOCOL_FILES: ReadonlySet<string> = new Set(["src/auth/provider.ts", "src/auth/client-registration.ts"]);
const OAUTH_PROTOCOL_TYPES: ReadonlySet<string> = new Set([
  "InvalidGrantError",
  "InvalidTargetError",
  "InvalidTokenError",
  "InvalidRequestError",
]);

// Recognized form #3: throws inside a cockatiel-policy-governed callback (and
// the executor wrapper that re-runs/normalizes around it). cockatiel's
// `execute()` contract is throw-based — a matched marker (TransientHTTPError /
// NetworkRetryableError) is retried, an unmatched throw (PaprikaAPIError,
// TokenExpiredError, an auth rejection) escapes the retry loop — so EVERY
// outcome inside the governed closure speaks in throws; the owned edge converts
// to `Result` immediately outside it (ADR-0014: "the wrapper's internals may
// still use throw-based control flow where a library demands it"). Pinned to
// (file, innerFn, outerFn): the throw's nearest function AND the function that
// encloses it must both match, so a future unrelated `execute`/`attempt` added
// elsewhere in these files can't silently sanction its own throws.
const COCKATIEL_GOVERNED: ReadonlyArray<readonly [file: string, innerFn: string, outerFn: string]> = [
  ["src/paprika/client.ts", "attempt", "authenticate"],
  ["src/paprika/client.ts", "execute", "request"],
  ["src/utils/resilience.ts", "execute", "createResilientExecutor"],
  ["src/features/embeddings.ts", "execute", "embedBatch"],
  ["src/features/photography.ts", "execute", "generate"],
];

// Recognized form #5: fail-fast at process entry and kernel construction, off
// the request path. Pinned to exact files (not a directory prefix) so a throw
// added to a request-serving sibling — e.g. src/transport/http.ts — is NOT
// waved through; and within registry.ts (which also holds the sync driver) to
// the construction-time dependency-graph check, so a future throw on the
// driver path is NOT silently sanctioned.
const BOOT_SITES: ReadonlyArray<readonly [file: string, fn: string]> = [
  ["src/index.ts", "*"],
  ["src/transport/e2e-server.ts", "*"],
  ["src/kernel/registry.ts", "visit"],
  // buildAuthContext is the HTTP transport's auth bootstrap: config invariants
  // and the Result unwraps that abort startup. Pinned to the function, not the
  // file, so a throw added to a request-serving sibling in build.ts would fail.
  ["src/auth/build.ts", "buildAuthContext"],
];

// The ratcheting allowlist, now EMPTY (see the header). An entry is
// [file, trackingIssue]; the staleness assertion forces deletion the moment the
// module stops throwing an unsanctioned form.
const PENDING: ReadonlyArray<readonly [file: string, convertedBy: string]> = [];

interface ThrowSite {
  readonly file: string;
  readonly line: number;
  readonly enclosingFn: string;
  /** Every named enclosing function, innermost first — `enclosingFn` is element 0. */
  readonly enclosingChain: ReadonlyArray<string>;
  /** Constructor name when the throw is `throw new X(...)`, else null. */
  readonly thrownType: string | null;
}

const TEST_SUFFIXES = [".test.ts", ".test.integration.ts", ".e2e.test.ts", ".external.test.ts", ".property.test.ts"];

// Every non-test `.ts` under src/, as forward-slash paths. Mirrors the
// `readdirSync(recursive)` walk scripts/tool-specs.ts uses, normalized so the
// path comparisons below hold regardless of the platform separator.
function sourceFiles(): Array<string> {
  return readdirSync("src", { recursive: true })
    .map((p) => `src/${String(p).split(sep).join("/")}`)
    .filter((p) => p.endsWith(".ts") && !TEST_SUFFIXES.some((s) => p.endsWith(s)));
}

function enclosingFnChain(node: ts.Node, sf: ts.SourceFile): Array<string> {
  const chain: Array<string> = [];
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) chain.push(p.name.text);
    else if (ts.isMethodDeclaration(p)) chain.push(p.name.getText(sf));
    else if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      const par = p.parent;
      if (ts.isVariableDeclaration(par) && ts.isIdentifier(par.name)) chain.push(par.name.text);
      else if (ts.isPropertyAssignment(par)) chain.push(par.name.getText(sf));
    }
  }
  return chain;
}

function throwSites(file: string): Array<ThrowSite> {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const sites: Array<ThrowSite> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isThrowStatement(node)) {
      const chain = enclosingFnChain(node, sf);
      const expr = node.expression;
      sites.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        enclosingFn: chain[0] ?? "<top>",
        enclosingChain: chain,
        thrownType: ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) ? expr.expression.text : null,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

const isBoot = (s: ThrowSite): boolean =>
  BOOT_SITES.some(([file, fn]) => s.file === file && (fn === "*" || s.enclosingFn === fn));
const isRecognizedHelper = (s: ThrowSite): boolean =>
  RECOGNIZED_HELPERS.some(([file, fn]) => s.file === file && s.enclosingFn === fn);
const isCockatielGoverned = (s: ThrowSite): boolean =>
  COCKATIEL_GOVERNED.some(
    ([file, innerFn, outerFn]) =>
      s.file === file && s.enclosingFn === innerFn && s.enclosingChain.slice(1).includes(outerFn),
  );
const isOAuthProtocolThrow = (s: ThrowSite): boolean =>
  OAUTH_PROTOCOL_FILES.has(s.file) && s.thrownType !== null && OAUTH_PROTOCOL_TYPES.has(s.thrownType);
const isRecognized = (s: ThrowSite): boolean =>
  isRecognizedHelper(s) || isCockatielGoverned(s) || isOAuthProtocolThrow(s) || isBoot(s);

describe("ADR-0014: owned code throws only in recognized forms", () => {
  const allSites = sourceFiles().flatMap(throwSites);
  const pendingFiles = new Set(PENDING.map(([file]) => file));

  it("has no unsanctioned throw outside the ratcheting allowlist", () => {
    const violations = allSites
      .filter((s) => !isRecognized(s) && !pendingFiles.has(s.file))
      .map(
        (s) =>
          `${s.file}:${s.line} (in ${s.enclosingFn}) — return a Result, use a recognized form ` +
          `(assertNever / resourceNotFound), or add a tracked allowlist entry (ADR-0014)`,
      );
    expect(violations).toEqual([]);
  });

  it("has no stale allowlist entry — delete an entry once its module stops throwing", () => {
    const stale = PENDING.filter(([file]) => allSites.filter((s) => s.file === file).every(isRecognized)).map(
      ([file, convertedBy]) =>
        `${file} — no longer throws an unsanctioned form (converted, moved, or deleted); ` +
        `remove or update this allowlist entry (was tracked by ${convertedBy})`,
    );
    expect(stale).toEqual([]);
  });
});
