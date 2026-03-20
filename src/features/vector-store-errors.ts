/**
 * Error class for vector store operations.
 *
 * Covers initialization failures, corruption recovery, and indexing errors.
 * Supports ES2024 ErrorOptions for cause chaining.
 */

/**
 * Base error class for all vector store operations.
 */
export class VectorStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VectorStoreError";
  }
}
