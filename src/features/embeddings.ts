/**
 * HTTP client for embedding services with OpenAI-compatible `/v1/embeddings` endpoints.
 *
 * Includes:
 * - EmbeddingClient: cockatiel-resilient HTTP client with retry and circuit breaker
 * - recipeToEmbeddingText: pure function for converting recipes to embedding text
 */

import type { IRetryContext } from "cockatiel";
import type { Logger } from "pino";
import { z } from "zod";

import type { Recipe } from "../recipe/types.js";
import type { EmbeddingConfig } from "../utils/config.js";

import { SILENT_LOG } from "../utils/log.js";
import {
  createResilientExecutor,
  type ResilientExecutor,
  RETRYABLE_STATUSES,
  TransientHTTPError,
} from "../utils/resilience.js";
import { EmbeddingAPIError, EmbeddingError } from "./embedding-errors.js";

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
  private readonly log: Logger;
  private readonly _executor: ResilientExecutor;
  private _dimensions: number | null = null;

  constructor(config: Readonly<EmbeddingConfig>, log?: Logger) {
    this._baseUrl = config.baseUrl.replace(/\/+$/, "");
    this._apiKey = config.apiKey;
    this._model = config.model;
    this.log = log ?? SILENT_LOG;

    // Per-instance resilience stack (breaker outside retry; see resilience.ts).
    // `logLabel: "embedding"` preserves the existing log-message wording.
    this._executor = createResilientExecutor({
      service: "embeddings",
      logLabel: "embedding",
      log: this.log,
    });
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
   * @throws EmbeddingAPIError on permanent HTTP errors from the embedding provider
   * @throws CircuitOpenError when the local circuit breaker is open (no HTTP request issued)
   * @throws ZodError on response validation failure
   * @throws TransientHTTPError (internally caught by resilience) on transient failures
   */
  async embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>> {
    const endpoint = `${this._baseUrl}/embeddings`;

    const execute = async (ctx: IRetryContext): Promise<Array<Array<number>>> => {
      const attempt = ctx.attempt + 1;
      const t0 = performance.now();
      this.log.debug({ attempt }, "embedding request start");

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
        this.log.error({ status: response.status, attempt }, "embedding request failed (non-retryable)");
        throw new EmbeddingAPIError("Embedding API error", response.status, endpoint);
      }

      // Parse and validate response
      const json: unknown = await response.json();
      const parsed = EmbeddingResponseSchema.parse(json);

      // Cache dimensions from first embedding
      if (parsed.data.length > 0) {
        this._dimensions = parsed.data[0]!.embedding.length;
      }

      const attemptDurationMs = Math.round(performance.now() - t0);
      this.log.debug({ attempt, attemptDurationMs }, "embedding request ok");
      return parsed.data.map((d) => d.embedding);
    };

    // The executor maps a tripped breaker to CircuitOpenError("embeddings", endpoint);
    // permanent errors (EmbeddingAPIError) and ZodError propagate unchanged.
    return this._executor.execute(endpoint, execute);
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
