# Embedding Client Design

## Summary

This unit introduces an `EmbeddingClient` — an HTTP client that converts text into numeric vector representations ("embeddings") by calling any OpenAI-compatible `/v1/embeddings` API endpoint. Embeddings are arrays of floating-point numbers that encode semantic meaning; text with similar meaning produces vectors that are close together in high-dimensional space. The client is the foundation for Phase 3's semantic recipe search: later units will use it to index recipes into a vector store and power similarity queries.

The implementation follows the pattern already established by `PaprikaClient`, the project's existing HTTP client. It uses cockatiel's retry and circuit-breaker policies to tolerate transient failures (rate-limit 429s, server 5xx errors) without special-casing them at every call site. The companion pure function `recipeToEmbeddingText()` handles the data preparation concern separately: it selects the semantically meaningful fields from a recipe (name, description, categories, ingredients, notes) and assembles them into a single string optimized for embedding quality, deliberately excluding directions and nutritional info which would add noise rather than meaning.

## Definition of Done

1. **EmbeddingClient class** in `src/features/embeddings.ts` — HTTP client for any OpenAI-compatible `/v1/embeddings` endpoint, with cockatiel resilience (retry + circuit breaker for 429/5xx), configurable via `EmbeddingConfig` (apiKey, baseUrl, model). Methods: `embed(text)` and `embedBatch(texts)`. Throws domain errors on failure (Imperative Shell pattern). Exposes `dimensions` lazily after first call.

2. **`recipeToEmbeddingText()` pure function** — same file, standalone export. Converts Recipe + resolved category names into a single text string for embedding. Includes: name, description, categories, ingredients, notes. Excludes: directions, nutritional info.

3. **Tests** — MSW-mocked unit tests covering happy path, error handling, batch ordering, resilience behavior, and the pure text helper. Colocated as `src/features/embeddings.test.ts`.

4. **Out of scope:** VectorStore integration (P3-U04), entry point wiring (P3-U08), actual API calls to any provider.

## Acceptance Criteria

### p3-u03-embeddings.AC1: EmbeddingClient sends correct requests

- **p3-u03-embeddings.AC1.1 Success:** `embedBatch(["a", "b", "c"])` sends one POST to `{baseUrl}/embeddings` with `{ model, input: ["a", "b", "c"] }` and `Authorization: Bearer {apiKey}` header
- **p3-u03-embeddings.AC1.2 Success:** `embed(text)` returns a single `number[]` vector (delegates to `embedBatch`)
- **p3-u03-embeddings.AC1.3 Success:** Trailing slash is stripped from `baseUrl` — constructor with `https://api.example.com/v1/` produces requests to `https://api.example.com/v1/embeddings`
- **p3-u03-embeddings.AC1.4 Success:** Response is validated with Zod schema at boundary

### p3-u03-embeddings.AC2: Resilience handles transient failures

- **p3-u03-embeddings.AC2.1 Success:** 429 response triggers cockatiel retry; succeeds on subsequent 200
- **p3-u03-embeddings.AC2.2 Success:** 500/502/503 responses trigger retry
- **p3-u03-embeddings.AC2.3 Success:** After 5 consecutive transient failures, circuit breaker opens and subsequent calls throw `EmbeddingAPIError` with "circuit open" without hitting the network

### p3-u03-embeddings.AC3: Error handling for permanent failures

- **p3-u03-embeddings.AC3.1 Failure:** 400 response throws `EmbeddingAPIError` with status and endpoint (no retry)
- **p3-u03-embeddings.AC3.2 Failure:** 401 response throws `EmbeddingAPIError` (permanent — no re-auth flow)
- **p3-u03-embeddings.AC3.3 Failure:** Malformed response (missing `data` field) throws `ZodError`

### p3-u03-embeddings.AC4: Dimensions getter

- **p3-u03-embeddings.AC4.1 Success:** `dimensions` returns correct vector length after a successful `embed` or `embedBatch` call
- **p3-u03-embeddings.AC4.2 Failure:** `dimensions` throws `EmbeddingError` before any embedding call

### p3-u03-embeddings.AC5: recipeToEmbeddingText

- **p3-u03-embeddings.AC5.1 Success:** Output includes recipe name, description, resolved category names, ingredients, and notes
- **p3-u03-embeddings.AC5.2 Success:** Output excludes directions
- **p3-u03-embeddings.AC5.3 Edge:** Null/empty fields are omitted (no blank lines or empty labels)
- **p3-u03-embeddings.AC5.4 Edge:** Empty category array produces no "Categories:" line

## Glossary

- **Embedding**: A fixed-length array of floating-point numbers produced by an ML model that encodes the semantic meaning of a text string. Texts with similar meaning yield vectors that are numerically close together.
- **OpenAI-compatible endpoint**: A REST API that accepts `POST /v1/embeddings` with the same request/response shape as the OpenAI Embeddings API. Many providers (local models, third-party hosts) implement this contract, making clients portable across providers.
- **Dimensions**: The length of the vector an embedding model produces. Fixed per model (e.g., 1536 for `text-embedding-3-small`). Required by the vector store in P3-U04 to allocate index space; lazily exposed by `EmbeddingClient` after the first successful call reveals it.
- **EmbeddingConfig**: A configuration object (already in `src/utils/config.ts`) carrying `apiKey`, `baseUrl`, and `model` — the three values needed to target a specific embedding provider and model.
- **cockatiel**: A Node.js resilience library providing policies (retry, circuit breaker, bulkhead, etc.) that wrap async operations. Used in this project for HTTP fault tolerance.
- **Circuit breaker**: A cockatiel policy that tracks consecutive failures and "opens" after a threshold is reached, rejecting subsequent calls immediately without hitting the network. After a cooldown period it "half-opens" and allows one probe request through.
- **`wrap(retryPolicy, breakerPolicy)`**: The cockatiel composition order used here — the retry policy is outermost, so each retry attempt passes through the circuit breaker. If the breaker opens, the retry policy sees a `BrokenCircuitError` and stops retrying.
- **TransientHTTPError**: An internal signal class (not exported) used to tell cockatiel which HTTP status codes are retryable (429, 500, 502, 503). Same pattern as `PaprikaClient`.
- **Imperative Shell / Functional Core**: An architectural pattern where pure, side-effect-free logic is separated from I/O and stateful code. `recipeToEmbeddingText()` is the Functional Core; `EmbeddingClient` is the Imperative Shell.
- **MSW (Mock Service Worker)**: A testing library that intercepts `fetch` calls at the network level, allowing HTTP behavior to be mocked without modifying application code.
- **Semantic similarity**: The property of embeddings that makes them useful for search — recipes about "pasta with tomatoes" and "spaghetti marinara" will have vectors that are close together even without shared keywords.

## Architecture

OpenAI-compatible embedding client using raw `fetch` with cockatiel resilience, following the same patterns as `PaprikaClient` in `src/paprika/client.ts`.

**Two exports from `src/features/embeddings.ts`:**

- `EmbeddingClient` — Imperative Shell. HTTP client for `POST {baseUrl}/embeddings`. Configured via `EmbeddingConfig` from `src/utils/config.ts`. Uses cockatiel retry + circuit breaker for transient HTTP errors (429/500/502/503). Bearer token auth with static API key (no re-auth flow). Lazily caches embedding dimensionality after first successful call.

- `recipeToEmbeddingText()` — Functional Core. Pure function that assembles a Recipe and resolved category names into a single text string optimized for semantic similarity. Includes name, description, categories, ingredients, notes. Excludes directions (procedural noise) and nutritional info (not semantically meaningful).

**Error hierarchy in `src/features/embedding-errors.ts`:**

- `EmbeddingError` extends `Error` — base class for all embedding failures.
- `EmbeddingAPIError` extends `EmbeddingError` — HTTP failures from the embedding provider. Carries `readonly status: number` and `readonly endpoint: string`.

Internal (non-exported) `TransientHTTPError` in `embeddings.ts` signals cockatiel to retry. Same pattern as `PaprikaClient`.

**Resilience stack (module-level constants in `embeddings.ts`):**

```typescript
// Retry: 3 attempts, exponential backoff 500ms-10s
// Circuit breaker: opens after 5 consecutive transient failures, half-opens after 30s
// Composition: wrap(retryPolicy, breakerPolicy) — retry outer, breaker inner
```

**Client contract:**

```typescript
interface EmbeddingClient {
  embed(text: string): Promise<Array<number>>;
  embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>>;
  get dimensions(): number; // throws EmbeddingError before first call
}
```

**Response validation:** Zod schema validates the embedding API response at the boundary. Schema is module-internal (not exported).

```typescript
// Expected response shape
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
```

**No index sorting:** The OpenAI embeddings API guarantees response order matches input order. Response data is mapped directly without sorting by `index`.

**Key differences from PaprikaClient:**

- No token re-auth flow (static API key, 401 = permanent config error)
- No response envelope unwrapping (`{ result: T }` is Paprika-specific)
- No bulkhead (batch embedding is a single request, not fan-out)

## Existing Patterns

Investigation found the `PaprikaClient` in `src/paprika/client.ts` as the established HTTP client pattern. This design follows it closely:

- **Cockatiel composition:** `wrap(retryPolicy, breakerPolicy)` with `ExponentialBackoff` and `ConsecutiveBreaker`. Same configuration values (500ms/10s backoff, 5 consecutive failures, 30s half-open).
- **TransientHTTPError:** Internal signal class for retryable statuses (429/500/502/503).
- **Error hierarchy:** Separate error file (`embedding-errors.ts`) paralleling `src/paprika/errors.ts`. Same structure: base error, API error with status/endpoint.
- **Private `request()` method:** Inner `execute()` closure, outer try/catch for `BrokenCircuitError` mapping.
- **Zod validation at boundary:** Response parsed and validated before returning to callers.

**Divergences:**

- No re-auth flow — embedding APIs use static Bearer tokens, not refreshable session tokens.
- No bulkhead — embedding calls are batched into single requests, not fanned out.
- Response shape differs — no `{ result: T }` envelope.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Error Hierarchy and Embedding Client

**Goal:** Implement `EmbeddingClient` with full resilience stack, error classes, and Zod-validated responses. Include `recipeToEmbeddingText()` pure function. Verify with MSW-mocked tests.

**Verifies:** p3-u03-embeddings.AC1, p3-u03-embeddings.AC2, p3-u03-embeddings.AC3, p3-u03-embeddings.AC4, p3-u03-embeddings.AC5

**Components:**

- `src/features/embedding-errors.ts` — `EmbeddingError` base class, `EmbeddingAPIError` with status/endpoint
- `src/features/embeddings.ts` — `EmbeddingClient` class with cockatiel resilience, `recipeToEmbeddingText()` pure function, internal `TransientHTTPError`, Zod response schema
- `src/features/embeddings.test.ts` — MSW-mocked tests: happy path batch/single, error handling (400, 401, 429 retry, circuit breaker), `dimensions` getter, trailing slash stripping, Zod validation of malformed responses, `recipeToEmbeddingText` field inclusion/exclusion

**Dependencies:** `EmbeddingConfig` type from `src/utils/config.ts` (already exists), `Recipe` type from `src/paprika/types.ts` (already exists), cockatiel (already installed)

**Done when:** All tests pass, `pnpm typecheck` clean, `pnpm lint` clean

<!-- END_PHASE_1 -->

## Additional Considerations

**No empty batch handling:** If `embedBatch([])` is called, the API may return an empty `data` array or an error. No special handling is added — P3-U04 (VectorStore) guards against empty batch calls before invoking `embedBatch`. Adding a guard here would be redundant.

**Rate limits:** For large initial indexing passes, P3-U04 sends batches of ~100 texts. Most providers handle this. If rate-limited, the cockatiel retry with backoff handles 429 responses automatically. No additional rate-limiting logic needed in the client.
