import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";

import { describe, expect, it } from "vitest";

import { REDACT_PATHS } from "../../src/utils/log.js";

/**
 * ADR-0018 conformance — the custom telemetry namespace stays disciplined.
 *
 * Telemetry attributes travel further than logs (a collector, a dashboard, a
 * third-party backend), so the bar is STRICTER than `REDACT_PATHS`-censored
 * logging: identity and payload material must never be an attribute KEY at
 * all. This gate scans every `"mcp_paprika.…"` string literal in `src/` and
 * enforces two rules:
 *
 * 1. **Shape** — lowercase dot/underscore segments only (no camelCase, no
 *    uids, no free text smuggled into a name).
 * 2. **No sensitive terminal segment** — the final segment must not be one of
 *    the credential/identity key names the logger redacts (token, password,
 *    authorization, email, sub, …). A name like `mcp_paprika.user_email`
 *    fails here before it ever ships.
 *
 * Attribute VALUES are covered by the per-seam tests (which assert exact
 * enum values) and by review; this gate pins the namespace itself.
 */

const TEST_SUFFIXES = [".test.ts", ".test.integration.ts", ".e2e.test.ts", ".external.test.ts", ".property.test.ts"];

function sourceFiles(): Array<string> {
  return readdirSync("src", { recursive: true })
    .map((p) => `src/${String(p).split(sep).join("/")}`)
    .filter((p) => p.endsWith(".ts") && !TEST_SUFFIXES.some((s) => p.endsWith(s)));
}

const NAME_RE = /"(mcp_paprika\.[^"]*)"/g;
const WELL_FORMED = /^mcp_paprika(\.[a-z0-9_]+)+$/;

// Identity/credential key names that must never terminate a telemetry name.
// Derived from REDACT_PATHS (leaf key names, wildcards stripped) plus the
// identity claims the auth log lines carry but telemetry must not.
const SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set([
  ...REDACT_PATHS.map((p) => p.replace(/^\*\./, "").toLowerCase()),
  "email",
  "sub",
  "client_id",
  "uid",
  "url",
]);

describe("ADR-0018: custom telemetry names are well-formed and never identity-bearing", () => {
  const names = new Map<string, string>(); // name → first file seen
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(NAME_RE)) {
      if (!names.has(match[1]!)) names.set(match[1]!, file);
    }
  }

  it("found the namespace at all (guards against the scan silently matching nothing)", () => {
    expect(names.size).toBeGreaterThan(0);
  });

  it("every mcp_paprika.* name is lowercase dot/underscore segments", () => {
    const malformed = [...names.entries()]
      .filter(([name]) => !WELL_FORMED.test(name))
      .map(([name, file]) => `${name} (${file})`);
    expect(malformed).toEqual([]);
  });

  it("no name ends in a sensitive identity/credential segment", () => {
    const offenders = [...names.entries()]
      .filter(([name]) => SENSITIVE_SEGMENTS.has(name.split(".").at(-1) ?? ""))
      .map(([name, file]) => `${name} (${file})`);
    expect(offenders).toEqual([]);
  });
});
