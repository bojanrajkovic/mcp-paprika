# Feature Implementations

Last verified: 2026-03-19

## Purpose

Orchestrates business logic by composing the Paprika API client and caching layer. Provides high-level operations that tools and resources consume.

## Contracts

### embedding-errors.ts — Error hierarchy for embedding operations

Two-class hierarchy with ES2024 `ErrorOptions` cause chaining support.

| Class               | Extends          | Fields                                                 |
| ------------------- | ---------------- | ------------------------------------------------------ |
| `EmbeddingError`    | `Error`          | (base class for all embedding errors)                  |
| `EmbeddingAPIError` | `EmbeddingError` | `readonly status: number`, `readonly endpoint: string` |

### embeddings.ts — Embedding client and recipe-to-text conversion

`EmbeddingClient` is an HTTP client for OpenAI-compatible `/v1/embeddings` endpoints. Uses
cockatiel for resilience: exponential-backoff retry (3 attempts, 500ms-10s) on transient
HTTP errors (429, 500, 502, 503) and a circuit breaker (opens after 5 consecutive failures,
half-open after 30s). Validates responses with Zod at the boundary. Per-instance resilience
stack (no shared state between instances).

| Export                  | Signature / Description                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `EmbeddingClient`       | `constructor(config: Readonly<EmbeddingConfig>)` — resilient HTTP client |
| `.embed(text)`          | `Promise<Array<number>>` — embed a single text                           |
| `.embedBatch(texts)`    | `Promise<Array<Array<number>>>` — embed multiple texts in one call       |
| `.dimensions`           | `number` getter — throws `EmbeddingError` if no call made yet            |
| `recipeToEmbeddingText` | `(recipe, categoryNames) => string` — pure function, no I/O              |

**Invariants:**

- `EmbeddingClient` throws (does not return `Result`) because it wraps cockatiel which uses exceptions for control flow
- `recipeToEmbeddingText` includes name, description, categories, ingredients, notes; excludes directions and nutritional info
- `BrokenCircuitError` from cockatiel is caught and re-thrown as `EmbeddingAPIError` with status 503

## Dependencies

- **Uses:** `paprika/` (types), `utils/` (config types), `cockatiel`, `zod`
- **Used by:** `tools/`, `resources/`
- **Boundary:** Must not import from `tools/` or `resources/`
