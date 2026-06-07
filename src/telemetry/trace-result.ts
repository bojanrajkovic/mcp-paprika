// pattern: Functional Core
//
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
 */
export function traceResultAsync<T, E>(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  errorType: (error: E) => string,
  fn: () => ResultAsync<T, E>,
): ResultAsync<T, E> {
  const span = tracer.startSpan(name, options);
  return context
    .with(trace.setSpan(context.active(), span), fn)
    .map((value) => {
      span.end();
      return value;
    })
    .mapErr((error) => {
      span.setAttribute(ATTR_ERROR_TYPE, errorType(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      return error;
    });
}
