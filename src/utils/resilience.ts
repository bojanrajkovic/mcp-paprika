/**
 * Shared cockatiel resilience stack for OpenAI-compatible JSON HTTP clients.
 *
 * Both `EmbeddingClient` (`/v1/embeddings`) and `PhotographyClient`
 * (`/chat/completions` image output) talk JSON to OpenRouter and need the same
 * retry + circuit-breaker behavior: exponential-backoff retry on transient HTTP
 * failures (429/5xx) and a consecutive-failure breaker, with `BrokenCircuitError`
 * surfaced as the shared `CircuitOpenError`. This module owns that core so the
 * two clients don't duplicate it.
 *
 * `PaprikaClient` deliberately does NOT use this helper: it layers
 * undici-network-error retries (`NetworkRetryableError`) and 401 token-refresh
 * retries on top of the same core, which would leak provider-specific concerns
 * into this abstraction. It keeps its own bespoke stack.
 */
import {
  ExponentialBackoff,
  ConsecutiveBreaker,
  retry,
  circuitBreaker,
  handleType,
  wrap,
  BrokenCircuitError,
  type IRetryContext,
} from "cockatiel";
import type { Logger } from "pino";
import { SILENT_LOG } from "./log.js";
import { CircuitOpenError, type CircuitService } from "./errors.js";

/**
 * Internal marker for transient HTTP failures (429/5xx) that the resilience
 * stack should retry. Thrown by a client's request function and matched by
 * cockatiel's `handleType` policy; never escapes to callers (retries succeed or
 * it converts to a permanent error / circuit-open).
 */
export class TransientHTTPError extends Error {
  constructor(readonly status: number) {
    super(`Transient HTTP error (${status.toString()})`);
    this.name = "TransientHTTPError";
  }
}

/** HTTP status codes that should trigger a retry. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503]);

export interface ResilienceOptions {
  /** Circuit name for `CircuitOpenError` (must be a member of the `CircuitService` union). */
  readonly service: CircuitService;
  /**
   * Message prefix for the retry/breaker log records, e.g. `"embedding"` →
   * `"embedding request failed, retrying"`. Kept separate from `service` so log
   * vocabulary can stay singular/idiomatic while `service` matches the union.
   */
  readonly logLabel: string;
  readonly log?: Logger;
  /** Total network attempts = maxAttempts + 1 (the initial try). Default 3. */
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly breakerThreshold?: number;
  readonly halfOpenAfterMs?: number;
}

export interface ResilientExecutor {
  /**
   * Run `fn` through the retry+breaker stack. On a tripped breaker, the
   * cockatiel `BrokenCircuitError` is converted to `CircuitOpenError(service,
   * endpoint)`; all other errors propagate unchanged (callers map their own
   * permanent errors and validation failures).
   */
  execute<T>(endpoint: string, fn: (ctx: IRetryContext) => Promise<T>): Promise<T>;
}

/**
 * Build a per-instance resilience executor. The retry and breaker policies are
 * not shared between instances so a breaker tripping in one client (or test)
 * never leaks into another.
 *
 * The breaker wraps the retry (`wrap(breaker, retry)`), so it counts one failure
 * per `execute()` call regardless of how many retries that call exhausted
 * internally.
 */
export function createResilientExecutor(options: ResilienceOptions): ResilientExecutor {
  const log = options.log ?? SILENT_LOG;
  const { service, logLabel } = options;
  const maxAttempts = options.maxAttempts ?? 3;

  const retryPolicy = retry(handleType(TransientHTTPError), {
    maxAttempts,
    backoff: new ExponentialBackoff({
      initialDelay: options.initialDelayMs ?? 500,
      maxDelay: options.maxDelayMs ?? 10_000,
    }),
  });

  const breakerPolicy = circuitBreaker(handleType(TransientHTTPError), {
    halfOpenAfter: options.halfOpenAfterMs ?? 30_000,
    breaker: new ConsecutiveBreaker(options.breakerThreshold ?? 5),
  });

  // event.attempt is the 0-indexed upcoming-retry counter; +1 yields the
  // 1-indexed network-touch attempt number that inline log sites also use.
  retryPolicy.onRetry((event) => {
    if ("error" in event) {
      const err = event.error;
      const status = err instanceof TransientHTTPError ? err.status : undefined;
      log.warn(
        { err, status, attempt: event.attempt + 1, nextBackoffMs: event.delay },
        `${logLabel} request failed, retrying`,
      );
    }
  });

  retryPolicy.onGiveUp((event) => {
    if ("error" in event) {
      const err = event.error;
      const status = err instanceof TransientHTTPError ? err.status : undefined;
      log.error({ err, status }, `${logLabel} request gave up after retries`);
    }
  });

  breakerPolicy.onBreak(() => {
    log.warn({}, `${logLabel} circuit breaker opened`);
  });
  breakerPolicy.onReset(() => {
    log.info({}, `${logLabel} circuit breaker reset`);
  });
  breakerPolicy.onHalfOpen(() => {
    log.info({}, `${logLabel} circuit breaker half-open (probe pending)`);
  });

  const resilience = wrap(breakerPolicy, retryPolicy);

  return {
    async execute<T>(endpoint: string, fn: (ctx: IRetryContext) => Promise<T>): Promise<T> {
      try {
        return await resilience.execute(fn);
      } catch (error) {
        if (error instanceof BrokenCircuitError) {
          throw new CircuitOpenError(service, endpoint, { cause: error });
        }
        throw error;
      }
    },
  };
}
