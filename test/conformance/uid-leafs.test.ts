import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ADR-0016 conformance — every domain declares its UID brands in its own
 * `src/domains/<domain>/ids.ts` leaf, and the leaf imports nothing but zod.
 *
 * The leaf-purity rule is what makes distributed brands safe: brands are
 * runtime zod values, so a leaf that imported richer neighbors could create a
 * value-level import cycle the day a domain grows a back-reference. A pure
 * leaf forecloses the class. Ownership (one leaf per brand string) replaces
 * the visibility the old central `src/ids.ts` gave for free — two leafs
 * declaring the same brand would make two UID kinds silently cross-assignable.
 * Containment (brands appear nowhere else) keeps both checks honest: a brand
 * declared inline in a `types.ts` would bypass purity entirely, and it also
 * guards these assertions against glob rot if the leafs ever move again.
 *
 * Like the ADR-0014 throw gate, recognition is syntactic (AST, so comments
 * don't count): a determined evasion — aliasing `.brand` through a variable —
 * defeats it, and is review's problem, not this gate's.
 */

const LEAF = /^src\/domains\/[^/]+\/ids\.ts$/;

const TEST_SUFFIXES = [".test.ts", ".test.integration.ts", ".e2e.test.ts", ".external.test.ts", ".property.test.ts"];

// Every non-test `.ts` under src/, as forward-slash paths — the same walk the
// ADR-0014 gate uses, normalized so path comparisons hold across platforms.
function sourceFiles(): Array<string> {
  return readdirSync("src", { recursive: true })
    .map((p) => `src/${String(p).split(sep).join("/")}`)
    .filter((p) => p.endsWith(".ts") && !TEST_SUFFIXES.some((s) => p.endsWith(s)));
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

interface ModuleRef {
  readonly kind: "import" | "re-export" | "dynamic import" | "require";
  readonly spec: string;
  readonly line: number;
}

interface BrandCall {
  /** The brand string literal, or null when the argument shape is anything else. */
  readonly brand: string | null;
  readonly line: number;
}

function lineOf(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Every way a module can pull in another module's runtime value (or re-publish one). */
function moduleRefs(sf: ts.SourceFile): Array<ModuleRef> {
  const refs: Array<ModuleRef> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ kind: "import", spec: node.moduleSpecifier.text, line: lineOf(node, sf) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ kind: "re-export", spec: node.moduleSpecifier.text, line: lineOf(node, sf) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      const spec = arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : "<computed>";
      refs.push({ kind: "dynamic import", spec, line: lineOf(node, sf) });
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const arg = node.arguments[0];
      const spec = arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : "<computed>";
      refs.push({ kind: "require", spec, line: lineOf(node, sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

/** Every `.brand(...)` call expression in the file. */
function brandCalls(sf: ts.SourceFile): Array<BrandCall> {
  const calls: Array<BrandCall> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "brand"
    ) {
      const arg = node.arguments[0];
      const brand = node.arguments.length === 1 && arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : null;
      calls.push({ brand, line: lineOf(node, sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

describe("ADR-0016: per-domain UID leafs are pure, owned, and exhaustive", () => {
  const files = sourceFiles();
  const leafs = files.filter((f) => LEAF.test(f));

  it("every UID leaf references no module but zod", () => {
    // Vacuity guard: if the leafs move and this glob rots, fail loudly rather
    // than passing against nothing (containment below also backstops this).
    expect(leafs).not.toHaveLength(0);

    const violations = leafs.flatMap((file) =>
      moduleRefs(parse(file))
        .filter((r) => r.kind !== "import" || r.spec !== "zod")
        .map(
          (r) =>
            `${file}:${r.line} — ${r.kind} of "${r.spec}"; a UID leaf imports nothing but zod. ` +
            `FK consumers import the owning domain's leaf, never the reverse (ADR-0016)`,
        ),
    );
    expect(violations).toEqual([]);
  });

  it("a brand string is owned by exactly one leaf (intra-leaf reuse is legal: the aisle sentinel)", () => {
    const owners = new Map<string, Set<string>>();
    const violations: Array<string> = [];
    for (const file of leafs) {
      for (const call of brandCalls(parse(file))) {
        if (call.brand === null) {
          violations.push(
            `${file}:${call.line} — .brand(...) must take a single string literal ` +
              `so ownership stays syntactically checkable (ADR-0016)`,
          );
          continue;
        }
        const set = owners.get(call.brand) ?? new Set<string>();
        set.add(file);
        owners.set(call.brand, set);
      }
    }
    for (const [brand, where] of owners) {
      if (where.size > 1) {
        violations.push(
          `brand "${brand}" is declared in ${[...where].sort().join(" and ")} — ` +
            `two leafs sharing a brand make their UID kinds silently cross-assignable; ` +
            `one domain owns each brand (ADR-0016)`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("brands are declared only in domain ids.ts leafs", () => {
    const violations = files
      .filter((f) => !LEAF.test(f))
      .flatMap((file) =>
        brandCalls(parse(file)).map(
          (call) =>
            `${file}:${call.line} — .brand(...) outside a UID leaf; declare the brand in the ` +
            `owning domain's src/domains/<domain>/ids.ts (ADR-0016)`,
        ),
      );
    expect(violations).toEqual([]);
  });
});
