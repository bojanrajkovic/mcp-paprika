/**
 * Error class hierarchy for embedding operations.
 *
 * Two-class structure:
 * - EmbeddingError: base class for all embedding-related errors
 * - EmbeddingAPIError: HTTP errors with status and endpoint (extends EmbeddingError)
 *
 * All classes support ES2024 ErrorOptions for cause chaining.
 */

/**
 * Base error class for all embedding-related operations.
 */
export class EmbeddingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbeddingError";
  }
}

/**
 * Error thrown when an HTTP request to the embedding API fails.
 * Captures the HTTP status code and endpoint for debugging.
 *
 * The error message is formatted as: "message (HTTP status from endpoint)"
 */
export class EmbeddingAPIError extends EmbeddingError {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string, options?: ErrorOptions) {
    super(`${message} (HTTP ${status} from ${endpoint})`, options);
    this.name = "EmbeddingAPIError";
    this.status = status;
    this.endpoint = endpoint;
  }
}
