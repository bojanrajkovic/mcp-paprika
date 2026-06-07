// Operation lifecycle for the instrumented seams: one primitive
// (`startOperation`) owns the span, the duration timer, the exactly-once
// ending, and the error.type classing — so span status and the duration
// histogram's error.type can never disagree — with two rails over it:
// `traceResultAsync` for the neverthrow core (status from the Result arms,
// not exceptions — ADR-0014) and direct `startOperation` use for the
// throw-based protocol wrappers (kernel/tool.ts, shared/resources.ts), whose
// finish/fail adapters map their protocol outcomes onto `end()`.

import {
  type Attributes,
  context,
  type Histogram,
  type Span,
  type SpanOptions,
  SpanStatusCode,
  trace,
  type Tracer,
} from "@opentelemetry/api";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import type { ResultAsync } from "neverthrow";

import { startTimer } from "./scope.js";

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

/** A duration histogram to record at `end()`; `error.type` is appended to the attributes on a classed failure. */
export interface DurationRecording {
  /** The lazy-wrapped instrument (see scope.ts on why instruments are lazy). */
  readonly histogram: () => Histogram;
  /** Static, low-cardinality dimensions; every `end()` records with these. */
  readonly attributes?: Attributes;
}

/**
 * How an operation ended. `errorType` classes the outcome onto the span AND
 * the duration histogram; `isError` controls span status separately, because
 * a classed outcome is not always a failure (a gated tool call and an
 * answered protocol not-found carry an `error.type` with status UNSET).
 */
export interface OperationOutcome {
  readonly errorType?: string | undefined;
  readonly isError?: boolean;
}

export interface OperationHandle {
  readonly span: Span;
  /** End the span and record the duration — exactly once; later calls no-op. */
  end(outcome?: OperationOutcome): void;
}

/**
 * Start a span (+ duration timer) whose every way of ending funnels through
 * one latched `end()`: it stamps `error.type`, sets ERROR status when the
 * outcome is a real failure, ends the span, and records the duration
 * histogram with the same `error.type` appended. The latch is what makes the
 * multi-path seams safe — Result arms, throw paths, and the rejection tap can
 * all race to `end()` and the operation still records exactly once.
 */
export function startOperation(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  duration?: DurationRecording,
): OperationHandle {
  const span = tracer.startSpan(name, options);
  const elapsedSeconds = startTimer();
  let ended = false;
  return {
    span,
    end(outcome) {
      if (ended) return;
      ended = true;
      if (outcome?.errorType !== undefined) span.setAttribute(ATTR_ERROR_TYPE, outcome.errorType);
      if (outcome?.isError === true) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      if (duration !== undefined) {
        duration
          .histogram()
          .record(
            elapsedSeconds(),
            outcome?.errorType === undefined
              ? duration.attributes
              : { ...duration.attributes, [ATTR_ERROR_TYPE]: outcome.errorType },
          );
      }
    },
  };
}

export type TraceResultOptions<E> = SpanOptions & {
  /**
   * Maps the typed error to a LOW-CARDINALITY class name (an error tag or
   * constructor name — never a message). Defaults to {@link errorTypeName}.
   */
  readonly errorType?: (error: E) => string;
  /** Record this duration histogram at the operation's end. */
  readonly duration?: DurationRecording;
};

/**
 * Run `fn` under a new active operation and end it from the Result outcome:
 * `ok` ends untouched (status UNSET — absence of error is the OTel-idiomatic
 * success); `err` classes the failure via `options.errorType`.
 *
 * `fn` executes inside `context.with`, so spans started within it — including
 * the auto-instrumented undici fetch spans — parent correctly under this one.
 * The error value itself passes through unchanged in both arms; tracing a
 * pipeline never alters what the caller observes.
 *
 * Contract breaches don't leak the operation: `fn` throwing synchronously, or
 * the returned ResultAsync's underlying promise REJECTING (a throw inside a
 * chain callback — exactly the breach the sync driver's defensive catch
 * tolerates at cycle level), both end it as an error. The sync throw rethrows
 * unchanged (a throw-transparent passthrough, pinned in the ADR-0014
 * conformance gate); the rejection tap merely observes — the chain the caller
 * receives is untouched. `startOperation`'s latch keeps the end paths
 * mutually exclusive.
 */
export function traceResultAsync<T, E>(
  tracer: Tracer,
  name: string,
  options: TraceResultOptions<E>,
  fn: () => ResultAsync<T, E>,
): ResultAsync<T, E> {
  const { errorType = errorTypeName, duration, ...spanOptions } = options;
  const op = startOperation(tracer, name, spanOptions, duration);
  try {
    const traced = context.with(trace.setSpan(context.active(), op.span), fn);
    // Defensive rejection tap (see doc-comment). Promise.resolve adopts the
    // PromiseLike ResultAsync without consuming it; the success arm is a no-op
    // (the .map below already ended the operation by then).
    void Promise.resolve(traced).then(undefined, (cause: unknown) => {
      op.end({ errorType: errorTypeName(cause), isError: true });
    });
    return traced
      .map((value) => {
        op.end();
        return value;
      })
      .mapErr((error) => {
        op.end({ errorType: errorType(error), isError: true });
        return error;
      });
  } catch (cause) {
    op.end({ errorType: errorTypeName(cause), isError: true });
    throw cause;
  }
}
