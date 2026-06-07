/**
 * HTTP client for embedding services with OpenAI-compatible `/v1/embeddings` endpoints.
 *
 * Includes:
 * - EmbeddingClient: cockatiel-resilient HTTP client with retry and circuit breaker
 * - recipeToEmbeddingText: pure function for converting recipes to embedding text
 */

import { SpanKind, trace } from "@opentelemetry/api";
import type { IRetryContext } from "cockatiel";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";

import type { Recipe } from "../domains/recipe/types.js";
import type { EmbeddingConfig } from "../utils/config.js";

import { genAiClientOperationDuration, genAiClientTokenUsage } from "../telemetry/instruments.js";
import { getTracer } from "../telemetry/scope.js";
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_TOKEN_TYPE,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
} from "../telemetry/semconv.js";
import { traceResultAsync } from "../telemetry/trace-result.js";
import { urlHostLabel } from "../telemetry/url-scrub.js";
import { CircuitOpenError } from "../utils/errors.js";
import { SILENT_LOG, toMessage } from "../utils/log.js";
import {
  createResilientExecutor,
  type ResilientExecutor,
  RETRYABLE_STATUSES,
  TransientHTTPError,
} from "../utils/resilience.js";
import { EmbeddingAPIError, EmbeddingError } from "./embedding-errors.js";

/**
 * The client's public error union (ADR-0014): every public `EmbeddingClient`
 * method errs with one of these. `EmbeddingAPIError` (a subclass of
 * `EmbeddingError`) passes through from the wire classification;
 * `CircuitOpenError` surfaces a tripped breaker; a foreign escape (a `ZodError`
 * on a malformed body, an undici `TypeError`) is wrapped as a base
 * `EmbeddingError` at the edge with its message preserved.
 */
export type EmbeddingFailure = EmbeddingError | CircuitOpenError;

/** Normalize whatever escapes the resilience stack into {@link EmbeddingFailure}. */
function toEmbeddingFailure(error: unknown): EmbeddingFailure {
  if (error instanceof EmbeddingError || error instanceof CircuitOpenError) return error;
  return new EmbeddingError(toMessage(error), { cause: error });
}

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
  private readonly _genAiAttrs: Readonly<Record<string, string>>;
  private _dimensions: number | null = null;

  constructor(config: Readonly<EmbeddingConfig>, log?: Logger) {
    this._baseUrl = config.baseUrl.replace(/\/+$/, "");
    this._apiKey = config.apiKey;
    this._model = config.model;
    this.log = log ?? SILENT_LOG;
    // Provider = the endpoint host: the API is OpenAI-flavored but the actual
    // provider is whatever the operator pointed baseUrl at (OpenAI, Ollama, a
    // router) — one fixed value per deployment, so cardinality-safe.
    this._genAiAttrs = {
      [ATTR_GEN_AI_OPERATION_NAME]: "embeddings",
      [ATTR_GEN_AI_REQUEST_MODEL]: this._model,
      [ATTR_GEN_AI_PROVIDER_NAME]: urlHostLabel(this._baseUrl),
    };

    // Per-instance resilience stack (breaker outside retry; see resilience.ts).
    // `logLabel: "embedding"` preserves the existing log-message wording.
    this._executor = createResilientExecutor({
      service: "embeddings",
      logLabel: "embedding",
      log: this.log,
    });
  }

  /**
   * Dimensionality of the embedding vectors, or `null` until the first
   * successful embedding call has reported it.
   */
  get dimensions(): number | null {
    return this._dimensions;
  }

  /**
   * Embed multiple texts in a single batch.
   * Resolves ok with one embedding vector per input text. Errs with
   * {@link EmbeddingFailure}: `EmbeddingAPIError` on a permanent HTTP error,
   * `CircuitOpenError` when the local breaker is open (no HTTP request issued),
   * or a base `EmbeddingError` wrapping a foreign escape (malformed body,
   * network failure once retries are exhausted).
   */
  embedBatch(texts: ReadonlyArray<string>): ResultAsync<Array<Array<number>>, EmbeddingFailure> {
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

      // Usage is known only on the final, successful attempt — record it here
      // (on the logical span via the active context, and the token histogram).
      trace.getActiveSpan()?.setAttribute(ATTR_GEN_AI_USAGE_INPUT_TOKENS, parsed.usage.prompt_tokens);
      genAiClientTokenUsage().record(parsed.usage.prompt_tokens, {
        ...this._genAiAttrs,
        [ATTR_GEN_AI_TOKEN_TYPE]: "input",
      });

      const attemptDurationMs = Math.round(performance.now() - t0);
      this.log.debug({ attempt, attemptDurationMs }, "embedding request ok");
      return parsed.data.map((d) => d.embedding);
    };

    // The logical GenAI operation covers every retry attempt and backoff wait;
    // the per-attempt HTTP spans (undici instrumentation) parent under it, and
    // the duration histogram records at its end with the same error.type class.
    return traceResultAsync(
      getTracer(),
      `embeddings ${this._model}`,
      {
        kind: SpanKind.CLIENT,
        attributes: { ...this._genAiAttrs, "mcp_paprika.embeddings.batch_size": texts.length },
        duration: { histogram: genAiClientOperationDuration, attributes: this._genAiAttrs },
      },
      // The executor maps a tripped breaker to CircuitOpenError("embeddings", endpoint);
      // the throw-based cockatiel protocol ends at this owned edge (ADR-0014).
      () => ResultAsync.fromPromise(this._executor.execute(endpoint, execute), toEmbeddingFailure),
    );
  }

  /**
   * Embed a single text.
   * Delegates to embedBatch() and resolves with the first (and only) embedding;
   * errs as embedBatch() does, plus `EmbeddingError` on an empty response.
   */
  embed(text: string): ResultAsync<Array<number>, EmbeddingFailure> {
    return this.embedBatch([text]).andThen((embeddings) => {
      const first = embeddings[0];
      if (first === undefined) {
        return errAsync(new EmbeddingError("Empty embedding response"));
      }
      return okAsync(first);
    });
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
