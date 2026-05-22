/**
 * HTTP client for embedding services with OpenAI-compatible `/v1/embeddings` endpoints.
 *
 * Includes:
 * - EmbeddingClient: cockatiel-resilient HTTP client with retry and circuit breaker
 * - recipeToEmbeddingText: pure function for converting recipes to embedding text
 */

import {
  ExponentialBackoff,
  ConsecutiveBreaker,
  retry,
  circuitBreaker,
  handleType,
  wrap,
  BrokenCircuitError,
  type IPolicy,
  type IRetryContext,
} from "cockatiel";
import pino, { type Logger } from "pino";
import { z } from "zod";
import type { Recipe } from "../paprika/types.js";
import type { EmbeddingConfig } from "../utils/config.js";
import { EmbeddingError, EmbeddingAPIError } from "./embedding-errors.js";

/**
 * Internal error class to signal transient HTTP errors for cockatiel.
 * Not exported — used only within this module for resilience signaling.
 */
class TransientHTTPError extends Error {
  constructor(readonly status: number) {
    super(`Transient HTTP error (${status.toString()})`);
    this.name = "TransientHTTPError";
  }
}

/**
 * HTTP status codes that should trigger retry.
 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

/**
 * Zod schema for validating embedding API responses.
 * Validates the OpenAI-compatible `/v1/embeddings` response format.
 */
const EmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number(),
      embedding: z.array(z.number()),
    }),
  ),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

/**
 * HTTP client for embedding services.
 *
 * Uses cockatiel for resilience:
 * - Retries on transient failures (429, 500, 502, 503) with exponential backoff
 * - Circuit breaker opens after 5 consecutive transient failures
 *
 * Validates responses with Zod schemas at the boundary.
 *
 * Per-instance resilience stack (not shared between instances) to avoid
 * circuit breaker state leaking between tests or concurrent clients.
 */
export class EmbeddingClient {
  private readonly _baseUrl: string;
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _log: Logger;
  private readonly _retryPolicy: ReturnType<typeof retry>;
  private readonly _breakerPolicy: ReturnType<typeof circuitBreaker>;
  private readonly _resilience: IPolicy<IRetryContext, never>;
  private _dimensions: number | null = null;

  constructor(config: Readonly<EmbeddingConfig>, log?: Logger) {
    this._baseUrl = config.baseUrl.replace(/\/+$/, "");
    this._apiKey = config.apiKey;
    this._model = config.model;
    this._log = log ?? pino({ level: "silent" });

    // Per-instance resilience stack
    this._retryPolicy = retry(handleType(TransientHTTPError), {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({
        initialDelay: 500,
        maxDelay: 10_000,
      }),
    });

    this._breakerPolicy = circuitBreaker(handleType(TransientHTTPError), {
      halfOpenAfter: 30_000,
      breaker: new ConsecutiveBreaker(5),
    });

    // event.attempt is the upcoming retry number (1 = first retry).
    // Normalize: upcoming retry N → attempt N+1 in 1-indexed network-touch terms.
    // The upcoming 2nd network touch = first retry = event.attempt 1 → log attempt 2.
    // Mirrors the paprika client normalization pattern.
    this._retryPolicy.onRetry((event) => {
      if ("error" in event) {
        const err = event.error;
        const status = err instanceof TransientHTTPError ? err.status : undefined;
        this._log.warn(
          { err, status, attempt: event.attempt + 1, nextBackoffMs: event.delay },
          "embedding request failed, retrying",
        );
      }
    });

    this._retryPolicy.onGiveUp((event) => {
      if ("error" in event) {
        const err = event.error;
        const status = err instanceof TransientHTTPError ? err.status : undefined;
        this._log.error({ err, status }, "embedding request gave up after retries");
      }
    });

    this._resilience = wrap(this._retryPolicy, this._breakerPolicy);
  }

  /**
   * Get the dimensionality of the embedding vectors.
   * Must be called after at least one successful embedding call.
   *
   * @throws EmbeddingError if no embedding call has been made yet
   */
  get dimensions(): number {
    if (this._dimensions === null) {
      throw new EmbeddingError("Dimensions unknown: no embedding call has been made yet");
    }
    return this._dimensions;
  }

  /**
   * Embed multiple texts in a single batch.
   * Returns an array of embedding vectors, one per input text.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding vectors (each is an array of numbers)
   * @throws EmbeddingAPIError on permanent HTTP errors or circuit breaker open
   * @throws ZodError on response validation failure
   * @throws TransientHTTPError (internally caught by resilience) on transient failures
   */
  async embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>> {
    const endpoint = `${this._baseUrl}/embeddings`;

    const execute = async (ctx: IRetryContext): Promise<Array<Array<number>>> => {
      const attempt = ctx.attempt + 1;
      const start = performance.now();
      this._log.debug({ attempt }, "embedding request start");

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this._apiKey}`,
        },
        body: JSON.stringify({
          model: this._model,
          input: texts,
        }),
      });

      // Check for transient vs permanent errors
      if (!response.ok) {
        if (RETRYABLE_STATUSES.has(response.status)) {
          // onRetry hook will log the warn; just throw for cockatiel to handle
          throw new TransientHTTPError(response.status);
        }
        this._log.error({ status: response.status, attempt }, "embedding request failed (non-retryable)");
        throw new EmbeddingAPIError("Embedding API error", response.status, endpoint);
      }

      // Parse and validate response
      const json: unknown = await response.json();
      const parsed = EmbeddingResponseSchema.parse(json);

      // Cache dimensions from first embedding
      if (parsed.data.length > 0) {
        this._dimensions = parsed.data[0]!.embedding.length;
      }

      const durationMs = Math.round(performance.now() - start);
      this._log.debug({ attempt, durationMs }, "embedding request ok");
      return parsed.data.map((d) => d.embedding);
    };

    try {
      const result = await this._resilience.execute(execute);
      return result as Array<Array<number>>;
    } catch (error) {
      if (error instanceof BrokenCircuitError) {
        throw new EmbeddingAPIError("Service unavailable (circuit open)", 503, endpoint);
      }
      throw error;
    }
  }

  /**
   * Embed a single text.
   * Delegates to embedBatch() and returns the first (and only) embedding.
   *
   * @param text - Text to embed
   * @returns Single embedding vector
   * @throws Same as embedBatch()
   */
  async embed(text: string): Promise<Array<number>> {
    const embeddings = await this.embedBatch([text]);
    const first = embeddings[0];
    if (first === undefined) {
      throw new EmbeddingError("Empty embedding response");
    }
    return first;
  }
}

/**
 * Schema version for the embedding text format.
 *
 * Bump this whenever `recipeToEmbeddingText` changes (fields added/removed,
 * format restructured) so that the vector store detects the change and
 * triggers a full re-index on next startup.
 */
export const EMBEDDING_SCHEMA_VERSION = 1;

/**
 * Convert a recipe to text suitable for embedding.
 *
 * Includes recipe name, description, category names, ingredients, and notes.
 * Excludes directions and nutritional info.
 * Omits any null or empty fields to avoid unnecessary text.
 *
 * @param recipe - Recipe to convert
 * @param categoryNames - Array of resolved category names
 * @returns Multi-line text representation of the recipe
 */
export function recipeToEmbeddingText(recipe: Readonly<Recipe>, categoryNames: ReadonlyArray<string>): string {
  const sections: Array<string> = [recipe.name];

  if (recipe.description) {
    sections.push(`Description: ${recipe.description}`);
  }

  if (categoryNames.length > 0) {
    sections.push(`Categories: ${categoryNames.join(", ")}`);
  }

  if (recipe.ingredients) {
    sections.push(`Ingredients: ${recipe.ingredients}`);
  }

  if (recipe.notes) {
    sections.push(`Notes: ${recipe.notes}`);
  }

  return sections.join("\n\n");
}
