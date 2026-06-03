/**
 * Reads HAR 1.2 files from docs/wire-captures/ and generates TypeScript
 * fixture modules in test/fixtures/wire-captures/.
 *
 * Each generated module exports:
 *   - A `fixtures` object keyed by HAR entry `comment` with `as const`
 *     (compile-time key safety — accessing a nonexistent fixture is a type error)
 *   - A `handlers` array of MSW HttpHandlers via @msw/source's fromTraffic()
 *
 * Usage:
 *   npx tsx scripts/generate-har-fixtures.ts
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const HAR_DIR = join(PROJECT_ROOT, "docs", "wire-captures");
const OUT_DIR = join(PROJECT_ROOT, "test", "fixtures", "wire-captures");

interface HarEntry {
  comment?: string;
  request: {
    method: string;
    url: string;
    postData?: { text?: string };
  };
  response: {
    status: number;
    content: { text?: string };
  };
}

interface HarFile {
  log: { entries: HarEntry[] };
}

function escapeKey(s: string): string {
  return JSON.stringify(s);
}

function generateFixtureModule(harPath: string): string {
  const raw = readFileSync(harPath, "utf-8");
  const har: HarFile = JSON.parse(raw);
  const harBasename = basename(harPath);

  const entries = har.log.entries.filter((e) => e.comment);

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.comment!)) {
      throw new Error(`Duplicate comment in ${harBasename}: ${JSON.stringify(entry.comment)}`);
    }
    seen.add(entry.comment!);
  }

  const lines: string[] = [
    `// Generated from docs/wire-captures/${harBasename} — do not edit`,
    `// Regenerate with: npx tsx scripts/generate-har-fixtures.ts`,
    ``,
    `import { fromTraffic } from "@msw/source/traffic";`,
    `import type Har from "har-format";`,
    `import type { HttpHandler } from "msw";`,
    ``,
    `/* eslint-disable */`,
    ``,
  ];

  lines.push(`const har = ${raw.trimEnd()} as const;`);
  lines.push(``);

  lines.push(`interface Fixture {`);
  lines.push(`  readonly method: string;`);
  lines.push(`  readonly url: string;`);
  lines.push(`  readonly status: number;`);
  lines.push(`  readonly requestBody: unknown;`);
  lines.push(`  readonly responseBody: unknown;`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`function parseBody(text: string | undefined): unknown {`);
  lines.push(`  if (!text) return null;`);
  lines.push(`  try { return JSON.parse(text); } catch { return text; }`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`function buildFixtures() {`);
  lines.push(`  const map = new Map<string, Fixture>();`);
  lines.push(`  for (const entry of har.log.entries) {`);
  lines.push(`    if (!entry.comment) continue;`);
  lines.push(`    const req = entry.request as { postData?: { text?: string }; method: string; url: string };`);
  lines.push(`    map.set(entry.comment, {`);
  lines.push(`      method: req.method,`);
  lines.push(`      url: req.url,`);
  lines.push(`      status: entry.response.status,`);
  lines.push(`      requestBody: parseBody(req.postData?.text),`);
  lines.push(`      responseBody: parseBody(entry.response.content.text),`);
  lines.push(`    });`);
  lines.push(`  }`);
  lines.push(`  return map;`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`const fixtureMap = buildFixtures();`);
  lines.push(``);

  // Type-safe key union from the comments
  lines.push(`export type FixtureKey =`);
  for (let i = 0; i < entries.length; i++) {
    const terminator = i === entries.length - 1 ? ";" : "";
    lines.push(`  | ${escapeKey(entries[i].comment!)}${terminator}`);
  }
  lines.push(``);

  lines.push(`export function fixture(key: FixtureKey): Fixture {`);
  lines.push(`  return fixtureMap.get(key)!;`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`export const handlers: ReadonlyArray<HttpHandler> = fromTraffic(har as unknown as Har.Har);`);
  lines.push(``);

  return lines.join("\n");
}

const harFiles = readdirSync(HAR_DIR).filter((f) => f.endsWith(".har.json"));

/* oxlint-disable no-console -- CLI script, not MCP server */
if (harFiles.length === 0) {
  console.error("No .har.json files found in", HAR_DIR);
  process.exit(1);
}

for (const file of harFiles) {
  const harPath = join(HAR_DIR, file);
  const moduleName = file.replace(/\.har\.json$/, "");
  const outPath = join(OUT_DIR, `${moduleName}.ts`);

  const source = generateFixtureModule(harPath);
  writeFileSync(outPath, source, "utf-8");
  console.log(`Generated ${outPath}`);
}

console.log(`\n${harFiles.length} fixture module(s) generated.`);
/* oxlint-enable no-console */
