import { context, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { traceResultAsync } from "./trace-result.js";

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

describe("traceResultAsync", () => {
  it("ends the span with status UNSET and passes the value through on ok", async () => {
    const result = await traceResultAsync(
      tracer,
      "op.ok",
      {},
      () => "unused",
      () => okAsync(42),
    );
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

  it("sets status ERROR plus error.type from the typed error and passes the error through on err", async () => {
    const result = await traceResultAsync(
      tracer,
      "op.err",
      {},
      (error: { readonly tag: string }) => error.tag,
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

  it("parents spans started inside fn under the helper's span", async () => {
    await traceResultAsync(
      tracer,
      "op.parent",
      {},
      () => "unused",
      () => {
        const child = tracer.startSpan("op.child");
        child.end();
        return okAsync(undefined);
      },
    );
    const parent = onlySpan("op.parent");
    const child = onlySpan("op.child");
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  it("ends the span (ERROR) and rethrows unchanged when fn breaks the contract by throwing synchronously", () => {
    const boom = new RangeError("contract breach");
    expect(() =>
      traceResultAsync(
        tracer,
        "op.sync_throw",
        {},
        () => "unused",
        () => {
          throw boom;
        },
      ),
    ).toThrow(boom);

    const span = onlySpan("op.sync_throw");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes["error.type"]).toBe("RangeError");
  });

  it("ends the span (ERROR) when the underlying promise rejects (contract breach), without altering the rejection", async () => {
    const boom = new TypeError("rejected chain");
    const breached = traceResultAsync(
      tracer,
      "op.rejection",
      {},
      () => "unused",
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
