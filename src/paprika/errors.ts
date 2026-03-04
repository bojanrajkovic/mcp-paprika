/**
 * Error class hierarchy for Paprika API operations.
 *
 * Three-class structure:
 * - PaprikaError: base class for all Paprika-related errors
 * - PaprikaAuthError: authentication failures (extends PaprikaError)
 * - PaprikaAPIError: HTTP errors with status and endpoint (extends PaprikaError)
 *
 * All classes support ES2024 ErrorOptions for cause chaining.
 */

/**
 * Base error class for all Paprika-related operations.
 * Extends the built-in Error class with proper name assignment.
 */
export class PaprikaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PaprikaError";
  }
}

/**
 * Error thrown when authentication fails.
 * Indicates that the provided credentials are invalid or expired.
 * Authentication failures are unrecoverable and typically require user intervention.
 */
export class PaprikaAuthError extends PaprikaError {
  constructor(message = "Authentication failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "PaprikaAuthError";
  }
}

/**
 * Error thrown when an HTTP request to the Paprika API fails.
 * Captures the HTTP status code and endpoint for debugging.
 *
 * The error message is formatted as: "message (HTTP status from endpoint)"
 * Example: "Not found (HTTP 404 from /api/v2/sync/recipe/abc/)"
 */
export class PaprikaAPIError extends PaprikaError {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string, options?: ErrorOptions) {
    super(`${message} (HTTP ${status} from ${endpoint})`, options);
    this.name = "PaprikaAPIError";
    this.status = status;
    this.endpoint = endpoint;
  }
}
