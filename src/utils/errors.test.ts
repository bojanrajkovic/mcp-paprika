import { describe, expect, it } from "vitest";

import { assertNever } from "./errors.js";

describe("assertNever", () => {
  it("throws naming the unexpected value when no message is given", () => {
    // Cast through `never` — the point is the runtime path the types forbid.
    expect(() => assertNever("surprise" as never)).toThrow(/Unreachable: unexpected value surprise/);
  });

  it("throws the caller's message when one is given", () => {
    expect(() => assertNever(3 as never, "unhandled pino level: 3")).toThrow("unhandled pino level: 3");
  });
});
