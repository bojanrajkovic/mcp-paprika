/**
 * Error class hierarchy for recipe-photo generation.
 *
 * Two-class structure, mirroring embedding-errors.ts:
 * - PhotographyError: base class for all photo-generation errors
 * - PhotographyAPIError: HTTP errors with status and endpoint (extends PhotographyError)
 *
 * All classes support ES2024 ErrorOptions for cause chaining. Local
 * breaker-open events surface as `CircuitOpenError` from `../utils/errors.js`
 * (shared with PaprikaClient and EmbeddingClient), not from this module.
 */

/**
 * Base error class for all photo-generation operations. Also thrown when the
 * provider returns a 200 with no image in the response (e.g. a refusal or a
 * text-only completion).
 */
export class PhotographyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PhotographyError";
  }
}

/**
 * Error thrown when an HTTP request to the image-generation API fails with a
 * permanent (non-retryable) status. Captures the status code and endpoint.
 *
 * The error message is formatted as: "message (HTTP status from endpoint)"
 */
export class PhotographyAPIError extends PhotographyError {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string, options?: ErrorOptions) {
    super(`${message} (HTTP ${status} from ${endpoint})`, options);
    this.name = "PhotographyAPIError";
    this.status = status;
    this.endpoint = endpoint;
  }
}
