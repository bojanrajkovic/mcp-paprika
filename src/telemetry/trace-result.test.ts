import { context, type Histogram, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startOperation, traceResultAsync } from "./trace-result.js";

// A real context manager (not the API's no-op default) is required for the
// context.with propagation the helper promises — child spans started inside
// `fn` must parent under the helper's span.
const contextManager = new AsyncLocalStorageContextManager();
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const tracer = provider.getTracer("trace-result-test");

beforeAll(() => {
  context.setGlobalContextManager(contextManager.enable());
});

afterAll(() => {
  context.disable();
});

beforeEach(() => {
  exporter.reset();
});

function onlySpan(name: string): ReadableSpan {
  const spans = exporter.getFinishedSpans().filter((s) => s.name === name);
  expect(spans).toHaveLength(1);
  return spans[0]!;
}

/** A fake lazy histogram — duration recording asserts against the spy, no MeterProvider needed. */
function fakeHistogram(): { histogram: () => Histogram; record: ReturnType<typeof vi.fn> } {
  const record = vi.fn();
  return { histogram: () => ({ record }) as unknown as Histogram, record };
}

describe("traceResultAsync", () => {
  it("ends the span with status UNSET and passes the value through on ok", async () => {
    const result = await traceResultAsync(tracer, "op.ok", {}, () => okAsync(42));
    result.match(
      (value) => {
        expect(value).toBe(42);
      },
      () => {
        expect.fail("Expected Ok but got Err");
      },
    );
    const span = onlySpan("op.ok");
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.attributes["error.type"]).toBeUndefined();
  });

  it("sets status ERROR plus error.type from the options classifier and passes the error through on err", async () => {
    const result = await traceResultAsync(
      tracer,
      "op.err",
      { errorType: (error: { readonly tag: string }) => error.tag },
      () => errAsync({ tag: "SyncError" }),
    );
    result.match(
      () => {
        expect.fail("Expected Err but got Ok");
      },
      (error) => {
        expect(error.tag).toBe("SyncError");
      },
    );
    const span = onlySpan("op.err");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes["error.type"]).toBe("SyncError");
  });

  it("defaults the error classifier to the constructor name", async () => {
    await traceResultAsync(tracer, "op.default_class", {}, () => errAsync(new RangeError("nope")));
    expect(onlySpan("op.default_class").attributes["error.type"]).toBe("RangeError");
  });

  it("parents spans started inside fn under the helper's span", async () => {
    await traceResultAsync(tracer, "op.parent", {}, () => {
      const child = tracer.startSpan("op.child");
      child.end();
      return okAsync(undefined);
    });
    const parent = onlySpan("op.parent");
    const child = onlySpan("op.child");
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  it("records the duration histogram once on ok, with the static attributes only", async () => {
    const { histogram, record } = fakeHistogram();
    await traceResultAsync(tracer, "op.duration_ok", { duration: { histogram, attributes: { dim: "a" } } }, () =>
      okAsync(1),
    );
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.any(Number), { dim: "a" });
  });

  it("records the duration histogram once on err, with error.type appended", async () => {
    const { histogram, record } = fakeHistogram();
    await traceResultAsync(tracer, "op.duration_err", { duration: { histogram, attributes: { dim: "a" } } }, () =>
      errAsync(new TypeError("boom")),
    );
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.any(Number), { dim: "a", "error.type": "TypeError" });
  });

  it("ends the operation (ERROR) and rethrows unchanged when fn breaks the contract by throwing synchronously", () => {
    const { histogram, record } = fakeHistogram();
    const boom = new RangeError("contract breach");
    expect(() =>
      traceResultAsync(tracer, "op.sync_throw", { duration: { histogram } }, () => {
        throw boom;
      }),
    ).toThrow(boom);

    const span = onlySpan("op.sync_throw");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("contract breach");
    expect(span.attributes["error.type"]).toBe("RangeError");
    // Throw rails record the semconv exception event — the stack IS the
    // diagnostic for abnormal control flow (Result-rail err arms never do).
    expect(span.events.some((event) => event.name === "exception")).toBe(true);
    expect(record).toHaveBeenCalledOnce();
  });

  it("a Result-rail err records no exception event (an expected outcome, not abnormal control flow)", async () => {
    await traceResultAsync(tracer, "op.no_exception", {}, () => errAsync(new TypeError("expected failure")));
    const span = onlySpan("op.no_exception");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events).toEqual([]);
  });

  it("ends the operation (ERROR) when the underlying promise rejects (contract breach), without altering the rejection", async () => {
    const boom = new TypeError("rejected chain");
    const breached = traceResultAsync(
      tracer,
      "op.rejection",
      {},
      // A ResultAsync whose underlying promise rejects — the breach the sync
      // driver's defensive catch tolerates at cycle level.
      () => new ResultAsync(Promise.reject(boom)) as ResultAsync<never, never>,
    );
    await expect(Promise.resolve(breached)).rejects.toBe(boom);
    // The rejection tap ends the span on a microtask; flush it.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    const span = onlySpan("op.rejection");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes["error.type"]).toBe("TypeError");
  });
});

describe("startOperation", () => {
  it("end() is latched: the span ends and the histogram records exactly once across competing end paths", () => {
    const { histogram, record } = fakeHistogram();
    const op = startOperation(tracer, "op.latch", {}, { histogram, attributes: { dim: "x" } });
    op.end({ errorType: "First", isError: true });
    op.end(); // late competing path — must no-op
    op.end({ errorType: "Third", isError: true });

    const span = onlySpan("op.latch");
    expect(span.attributes["error.type"]).toBe("First");
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.any(Number), { dim: "x", "error.type": "First" });
  });

  it("a classed outcome with isError false keeps span status UNSET (the gated / answered-protocol shape)", () => {
    const op = startOperation(tracer, "op.classed_unset", {});
    op.end({ errorType: "precondition_gated" });

    const span = onlySpan("op.classed_unset");
    expect(span.attributes["error.type"]).toBe("precondition_gated");
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });
});
