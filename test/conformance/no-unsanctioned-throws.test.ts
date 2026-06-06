import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ADR-0014 conformance — code we own returns `Result` and never throws to signal
 * a predictable outcome. This walks every `src` source file (AST, so comments
 * don't count) for `throw` statements and fails any that is neither a recognized
 * form nor a still-pending entry on the ratcheting allowlist below.
 *
 * The allowlist is the neverthrow campaign's visible, shrinking surface (#241):
 * each entry names the phase issue that handles that module. As a module flips,
 * its entry must be DELETED — the staleness check fails the build if an
 * allowlisted file no longer carries an unsanctioned throw, so the ratchet can
 * only tighten toward "nothing but the recognized forms remain."
 *
 * One of ADR-0014's five recognized forms has no recognizer here yet: the OAuth
 * error types (#2). Every file that throws them — auth — also still throws
 * forms its phase converts to `Result`, so those files sit in PENDING for now.
 * The phase that removes each entry (#265) adds the #2 recognizer at the same
 * time, so the file's permanent protocol throws stay sanctioned once its entry
 * is gone. Until then PENDING means "not yet handled," not "will become Result."
 */

// Recognized forms #1 + #4: the helper bodies whose `throw` IS the sanctioned
// boundary crossing. Pinned to (file, function) so a same-named helper added
// elsewhere can't silently sanction its own throws.
const RECOGNIZED_HELPERS: ReadonlyArray<readonly [file: string, fn: string]> = [
  ["src/utils/errors.ts", "assertNever"],
  ["src/utils/errors.ts", "unwrapAtBoot"],
  ["src/shared/resources.ts", "resourceNotFound"],
];

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
];

// The ratcheting allowlist: owned modules that still throw, each mapped to the
// campaign phase (#241) that handles it. DELETE an entry the moment its module
// stops throwing an unsanctioned form — the staleness assertion below enforces it.
const PENDING: ReadonlyArray<readonly [file: string, convertedBy: string]> = [
  ["src/features/embeddings.ts", "#265"],
  ["src/features/photography.ts", "#265"],
  ["src/features/json-vector-index.ts", "#265"],
  ["src/features/vector-store.ts", "#265"],
  ["src/auth/build.ts", "#265"],
  ["src/auth/client-registration.ts", "#265"],
  ["src/auth/oidc-client.ts", "#265"],
  ["src/auth/provider.ts", "#265"],
  ["src/auth/routes.ts", "#265"],
  // must() — the interim bridges from cache Results onto the SDK's throw-based
  // auth contracts; removed when #265 converts the auth runtime end to end.
  ["src/auth/token-store.ts", "#265"],
  ["src/auth/cleanup.ts", "#265"],
];

interface ThrowSite {
  readonly file: string;
  readonly line: number;
  readonly enclosingFn: string;
  /** Every named enclosing function, innermost first — `enclosingFn` is element 0. */
  readonly enclosingChain: ReadonlyArray<string>;
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
      sites.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        enclosingFn: chain[0] ?? "<top>",
        enclosingChain: chain,
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
const isRecognized = (s: ThrowSite): boolean => isRecognizedHelper(s) || isCockatielGoverned(s) || isBoot(s);

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
