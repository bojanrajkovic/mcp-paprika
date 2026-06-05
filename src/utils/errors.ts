/**
 * Cross-cutting error classes and helpers used by multiple modules.
 */

/**
 * Type guard for Node's `ErrnoException` shape — any `Error` whose `code`
 * property is set by the runtime (typical for `fs`/`net`/`child_process`).
 *
 * Use as: `if (isNodeError(err) && err.code === "ENOENT") { ... }`.
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Exhaustiveness assertion for a branch the types prove unreachable (a `switch`
 * `default`, an `else` that cannot happen). The `never` parameter makes adding a
 * new union variant a compile error here; at runtime it throws — the one
 * sanctioned "reached the unreachable" throw, recognized form #4 in ADR-0014.
 * Pass `message` to describe the surprise; the value is included by default.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unreachable: unexpected value ${String(value)}`);
}

/**
 * Short identifier for a client/subsystem that mounts cockatiel resilience.
 * Used as the `service` argument to `CircuitOpenError` and surfaces both in
 * the error message and as a structured field. Aligns with the surrounding
 * log component vocabulary. Adding a new client requires adding its name
 * here — that's intentional, so callers can't accidentally pass a typo or
 * an unknown service name.
 */
export type CircuitService = "paprika" | "embeddings" | "photography";

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
