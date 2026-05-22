/**
 * Cross-cutting error classes used by multiple modules.
 */

/**
 * Short identifier for a client/subsystem that mounts cockatiel resilience.
 * Used as the `service` argument to `CircuitOpenError` and surfaces both in
 * the error message and as a structured field. Aligns with the surrounding
 * log component vocabulary. Adding a new client requires adding its name
 * here — that's intentional, so callers can't accidentally pass a typo or
 * an unknown service name.
 */
export type CircuitService = "paprika" | "embeddings";

/**
 * Thrown when a cockatiel circuit breaker is open and rejects a call without
 * issuing any network request.
 *
 * Service-agnostic — used by every client whose resilience stack composes
 * `cockatiel`'s circuit breaker.
 *
 * Distinct from per-service HTTP-error classes: there is no HTTP status code
 * because no HTTP request was made. The `cause` is the underlying cockatiel
 * `BrokenCircuitError`.
 *
 * Message format: `<service> circuit breaker is open (endpoint=<url>)`.
 */
export class CircuitOpenError extends Error {
  override readonly name = "CircuitOpenError";
  readonly service: CircuitService;
  readonly endpoint: string;

  constructor(service: CircuitService, endpoint: string, options?: ErrorOptions) {
    super(`${service} circuit breaker is open (endpoint=${endpoint})`, options);
    this.service = service;
    this.endpoint = endpoint;
  }
}
