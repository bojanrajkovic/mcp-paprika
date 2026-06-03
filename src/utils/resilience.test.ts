import { describe, expect, it } from "vitest";

import { CircuitOpenError } from "./errors.js";
import { createResilientExecutor, RETRYABLE_STATUSES, TransientHTTPError } from "./resilience.js";

const fast = {
  service: "embeddings" as const,
  logLabel: "test",
  initialDelayMs: 1,
  maxDelayMs: 2,
};

describe("createResilientExecutor", () => {
  it("RETRYABLE_STATUSES contains 429 and the retryable 5xx codes", () => {
    expect([...RETRYABLE_STATUSES].sort((a, b) => a - b)).toEqual([429, 500, 502, 503]);
  });

  it("retries TransientHTTPError then succeeds, returning the value", async () => {
    const executor = createResilientExecutor({ ...fast, maxAttempts: 3 });
    let calls = 0;
    const result = await executor.execute("https://x/api", async () => {
      calls += 1;
      if (calls < 3) throw new TransientHTTPError(503);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3); // 2 transient failures + 1 success
  });

  it("propagates TransientHTTPError after exhausting retries", async () => {
    const executor = createResilientExecutor({ ...fast, maxAttempts: 2 });
    let calls = 0;
    await expect(
      executor.execute("https://x/api", async () => {
        calls += 1;
        throw new TransientHTTPError(500);
      }),
    ).rejects.toBeInstanceOf(TransientHTTPError);
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it("does NOT retry a non-transient error and surfaces it unchanged", async () => {
    const executor = createResilientExecutor({ ...fast, maxAttempts: 3 });
    let calls = 0;
    const permanent = new Error("permanent 400");
    await expect(
      executor.execute("https://x/api", async () => {
        calls += 1;
        throw permanent;
      }),
    ).rejects.toBe(permanent);
    expect(calls).toBe(1); // no retries for non-transient
  });

  it("trips the breaker after threshold consecutive failures → CircuitOpenError", async () => {
    const executor = createResilientExecutor({
      ...fast,
      maxAttempts: 0, // one attempt per call → one breaker failure per call
      breakerThreshold: 2,
      halfOpenAfterMs: 60_000,
    });
    const fail = (): Promise<never> =>
      executor.execute("https://x/embeddings", async () => {
        throw new TransientHTTPError(503);
      });

    // First two calls fail with the transient error and accumulate breaker failures.
    await expect(fail()).rejects.toBeInstanceOf(TransientHTTPError);
    await expect(fail()).rejects.toBeInstanceOf(TransientHTTPError);

    // Breaker now open: the next call is rejected without invoking the fn.
    let invoked = false;
    await expect(
      executor.execute("https://x/embeddings", async () => {
        invoked = true;
        throw new TransientHTTPError(503);
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(invoked).toBe(false);
  });

  it("CircuitOpenError carries the configured service and the call endpoint", async () => {
    const executor = createResilientExecutor({ ...fast, maxAttempts: 0, breakerThreshold: 1 });
    const endpoint = "https://x/embeddings";
    await expect(
      executor.execute(endpoint, async () => {
        throw new TransientHTTPError(503);
      }),
    ).rejects.toBeInstanceOf(TransientHTTPError);
    try {
      await executor.execute(endpoint, async () => "unused");
      expect.unreachable("breaker should be open");
    } catch (error) {
      expect(error).toBeInstanceOf(CircuitOpenError);
      expect((error as CircuitOpenError).service).toBe("embeddings");
      expect((error as CircuitOpenError).endpoint).toBe(endpoint);
    }
  });
});
