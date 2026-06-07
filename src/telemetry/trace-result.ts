// Result-native span lifecycle. The standard OTel recipe ends spans in
// try/catch/finally — but this codebase's core never throws to signal an
// outcome (ADR-0014), so the error signal is the `err` arm of a `ResultAsync`,
// not an exception. This helper draws span status from the Result arms and
// stamps `error.type` from the typed error, so seams stay `.map`/`.mapErr`
// pipelines with no telemetry-induced try blocks.

import { context, type SpanOptions, SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import type { ResultAsync } from "neverthrow";

/**
 * Low-cardinality `error.type` class for a thrown/typed error: the constructor
 * name for `Error` subclasses, `fallback` otherwise. The shared classifier for
 * every seam whose error union is class-based — one definition, so a non-Error
 * value on an error path degrades to the fallback instead of throwing a
 * TypeError inside the very telemetry arm meant to observe the failure.
 */
export function errorTypeName(error: unknown, fallback = "unknown"): string {
  return error instanceof Error ? error.constructor.name : fallback;
}

/**
 * Run `fn` under a new active span and end the span from the Result outcome:
 * `ok` ends it untouched (status UNSET — absence of error is the OTel-idiomatic
 * success), `err` sets status ERROR plus `error.type` via `errorType`, which
 * must map the typed error to a LOW-CARDINALITY class name (an error tag or
 * constructor name — never a message).
 *
 * `fn` executes inside `context.with`, so spans started within it — including
 * the auto-instrumented undici fetch spans — parent correctly under this one.
 * The error value itself passes through unchanged in both arms; tracing a
 * pipeline never alters what the caller observes.
 *
 * Contract breaches don't leak the span: `fn` throwing synchronously, or the
 * returned ResultAsync's underlying promise REJECTING (a throw inside a chain
 * callback — exactly the breach the sync driver's defensive catch tolerates at
 * cycle level), both end the span as an error. The sync throw rethrows
 * unchanged (a throw-transparent passthrough, pinned in the ADR-0014
 * conformance gate); the rejection tap merely observes — the chain the caller
 * receives is untouched. The `ended` latch makes the three end paths
 * (Result arms, sync throw, rejection) mutually exclusive.
 */
export function traceResultAsync<T, E>(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  errorType: (error: E) => string,
  fn: () => ResultAsync<T, E>,
): ResultAsync<T, E> {
  const span = tracer.startSpan(name, options);
  let ended = false;
  const endOk = (): void => {
    if (ended) return;
    ended = true;
    span.end();
  };
  const endErr = (type: string): void => {
    if (ended) return;
    ended = true;
    span.setAttribute(ATTR_ERROR_TYPE, type);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  };
  try {
    const traced = context.with(trace.setSpan(context.active(), span), fn);
    // Defensive rejection tap (see doc-comment). Promise.resolve adopts the
    // PromiseLike ResultAsync without consuming it; the success arm is a no-op
    // (the .map below already ended the span by then).
    void Promise.resolve(traced).then(undefined, (cause: unknown) => {
      endErr(errorTypeName(cause));
    });
    return traced
      .map((value) => {
        endOk();
        return value;
      })
      .mapErr((error) => {
        endErr(errorType(error));
        return error;
      });
  } catch (cause) {
    endErr(errorTypeName(cause));
    throw cause;
  }
}
