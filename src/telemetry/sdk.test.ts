import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import { setDiagLogTarget } from "./scope.js";
import { diagLogger } from "./sdk.js";

/** A bare pino logger that collects its JSON lines instead of writing them anywhere. */
function capturingLogger(): { logger: pino.Logger; records: () => Array<Record<string, unknown>> } {
  const lines: Array<string> = [];
  const logger = pino({ base: null, level: "trace" }, { write: (line: string) => lines.push(line) });
  return { logger, records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe("diagLogger", () => {
  afterEach(() => {
    setDiagLogTarget(undefined);
  });

  it("routes OTel diag lines to the target as structured records, keeping extra args as a field", () => {
    const { logger, records } = capturingLogger();
    setDiagLogTarget(logger);

    diagLogger().warn("exporter failed", 503, { url: "http://collector" });

    expect(records()).toMatchObject([
      { level: 40, component: "otel", msg: "exporter failed", args: [503, { url: "http://collector" }] },
    ]);
  });

  it("serializes an Error argument as err, keeping its message and stack", () => {
    const { logger, records } = capturingLogger();
    setDiagLogTarget(logger);

    diagLogger().error("export failed", new Error("ECONNREFUSED"));

    const [record] = records();
    expect(record).toMatchObject({ msg: "export failed", err: { message: "ECONNREFUSED" } });
    expect(record).toHaveProperty("err.stack", expect.stringContaining("ECONNREFUSED"));
    expect(record).not.toHaveProperty("args");
  });

  it("maps every OTel level onto pino, with verbose as trace", () => {
    const { logger, records } = capturingLogger();
    setDiagLogTarget(logger);
    const diag = diagLogger();

    diag.error("e");
    diag.warn("w");
    diag.info("i");
    diag.debug("d");
    diag.verbose("v");

    expect(records().map((r) => r["level"])).toEqual([50, 40, 30, 20, 10]);
  });

  it("reads the target at call time, so a logger set after install still receives lines", () => {
    const diag = diagLogger();
    const { logger, records } = capturingLogger();
    setDiagLogTarget(logger);

    diag.error("late");

    expect(records()).toMatchObject([{ msg: "late" }]);
  });
});
