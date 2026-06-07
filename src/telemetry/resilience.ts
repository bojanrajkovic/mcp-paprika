// Resilience-layer metrics, wired once per client onto the cockatiel policy
// hooks the clients already use for logging. Shared by the two resilience
// stacks (PaprikaClient's bespoke one and createResilientExecutor's), so the
// instrument descriptors and the client-label attribute exist exactly once.

import type { BulkheadPolicy, CircuitBreakerPolicy, RetryPolicy } from "cockatiel";

import { getMeter, lazy } from "./scope.js";

/** Which resilient client recorded — "paprika", "embedding", "photography". */
export const ATTR_CLIENT = "mcp_paprika.client";

const clientRetries = lazy(() =>
  getMeter().createCounter("mcp_paprika.client.retries", {
    description: "Retry attempts by the resilient HTTP clients",
    unit: "{retry}",
  }),
);

const clientGiveups = lazy(() =>
  getMeter().createCounter("mcp_paprika.client.giveups", {
    description: "Requests abandoned after exhausting retries",
    unit: "{request}",
  }),
);

const breakerState = lazy(() =>
  getMeter().createObservableGauge("mcp_paprika.client.breaker.state", {
    description: "Circuit breaker state (cockatiel CircuitState: 0 closed, 1 open, 2 half-open, 3 isolated)",
  }),
);

const bulkheadAvailableSlots = lazy(() =>
  getMeter().createObservableGauge("mcp_paprika.client.bulkhead.available_slots", {
    description: "Free execution slots in a client's bulkhead (0 = saturated)",
    unit: "{slot}",
  }),
);

/**
 * Attach retry/giveup counters and the breaker-state gauge to one client's
 * policies. Rides the same cockatiel hook surface the clients already log
 * through; the policies are per-instance (see utils/resilience.ts), so each
 * client wires its own. Observable callbacks fire only at collection time —
 * no cost on the request path.
 *
 * Per-process-singleton assumption is load-bearing: there is no
 * removeCallback, so every wired client pins a gauge callback (and its
 * closure) for the meter's lifetime. The resilient clients are all built
 * once per process today; a future per-request/per-session client must NOT
 * route through here without adding unregistration.
 */
export function wireResilienceTelemetry(
  client: string,
  retryPolicy: RetryPolicy,
  breakerPolicy: CircuitBreakerPolicy,
): void {
  const attrs = { [ATTR_CLIENT]: client };
  retryPolicy.onRetry(() => {
    clientRetries().add(1, attrs);
  });
  retryPolicy.onGiveUp(() => {
    clientGiveups().add(1, attrs);
  });
  breakerState().addCallback((result) => {
    result.observe(breakerPolicy.state, attrs);
  });
}

/** Observe a bulkhead's free execution slots (saturation signal for the recipe-fetch throttle). */
export function observeBulkhead(client: string, policy: BulkheadPolicy): void {
  bulkheadAvailableSlots().addCallback((result) => {
    result.observe(policy.executionSlots, { [ATTR_CLIENT]: client });
  });
}
