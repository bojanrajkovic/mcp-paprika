/**
 * Cross-cutting error classes used by multiple modules.
 */

/**
 * Thrown when a cockatiel circuit breaker is open and rejects a call without
 * issuing any network request.
 *
 * Service-agnostic — used by every client whose resilience stack composes
 * `cockatiel`'s circuit breaker. The `service` argument is a short identifier
 * that aligns with the surrounding log component vocabulary (`"paprika"`,
 * `"embeddings"`, etc.) and appears both in the message and as a structured
 * field on the serialized error.
 *
 * Distinct from per-service HTTP-error classes: there is no HTTP status code
 * because no HTTP request was made. The `cause` is the underlying cockatiel
 * `BrokenCircuitError`.
 *
 * Message format: `<service> circuit breaker is open (endpoint=<url>)`.
 */
export class CircuitOpenError extends Error {
  override readonly name = "CircuitOpenError";
  readonly service: string;
  readonly endpoint: string;

  constructor(service: string, endpoint: string, options?: ErrorOptions) {
    super(`${service} circuit breaker is open (endpoint=${endpoint})`, options);
    this.service = service;
    this.endpoint = endpoint;
  }
}
