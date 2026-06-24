import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PaprikaConfig } from "../../../utils/config.js";

import { makeKernelInfra, useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { registeredModules } from "../../../kernel/registry.js";
// Side-effect: self-register every module so registeredModules() is populated.
import "../../../kernel/modules.generated.js";

/** A minimal config with diagnostics on — the diag module reads only this flag. */
const diagOn = {
  transport: "stdio",
  diagnostics: true,
  sync: { enabled: true, pendingWriteTtl: 60_000, interval: 60_000, recipeFetchConcurrency: 4 },
} as unknown as PaprikaConfig;

const TOKEN_KEY = "forwarding_probe_token";

describe("diag_forwarding_probe", () => {
  const kh = useKernelHarness("diag", { config: diagOn });
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("places the token in structuredContent ONLY, never in the text block", async () => {
    const result = await kh.callTool("diag_forwarding_probe", {});

    const token = (result.structuredContent as Record<string, unknown>)[TOKEN_KEY];
    expect(typeof token).toBe("string");
    expect((token as string).length).toBeGreaterThan(0);

    // The whole point of the probe: the token must be absent from the text the
    // model always receives. If it leaked into the text, the probe would report a
    // false positive on every host.
    expect(getText(result)).not.toContain(token as string);
  });

  it("returns a fresh token on each call (so a memorized echo can't pass)", async () => {
    const a = (await kh.callTool("diag_forwarding_probe", {})).structuredContent as Record<string, unknown>;
    const b = (await kh.callTool("diag_forwarding_probe", {})).structuredContent as Record<string, unknown>;
    expect(a[TOKEN_KEY]).not.toBe(b[TOKEN_KEY]);
  });
});

describe("diag tool registration gate", () => {
  async function diagToolNames(diagnostics: boolean): Promise<ReadonlyArray<string>> {
    const diag = registeredModules().find((m) => m.id === "diag");
    expect(diag).toBeDefined();
    const infra = makeKernelInfra({ cacheDir: "/tmp/diag-gate-test", config: { ...diagOn, diagnostics } });
    const built = await diag!.build(infra, {});
    return built.tools.map((t) => t.spec.name);
  }

  it("registers the probe ONLY when diagnostics is enabled (absent in production)", async () => {
    expect(await diagToolNames(true)).toEqual(["diag_forwarding_probe"]);
    expect(await diagToolNames(false)).toEqual([]);
  });
});
