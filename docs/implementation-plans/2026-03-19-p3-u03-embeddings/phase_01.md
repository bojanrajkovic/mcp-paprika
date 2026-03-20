# Embedding Client Implementation Plan

**Goal:** Implement `EmbeddingClient` with cockatiel resilience, error classes, Zod-validated responses, and `recipeToEmbeddingText()` pure function.

**Architecture:** HTTP client for OpenAI-compatible `/v1/embeddings` endpoints using raw `fetch` with cockatiel retry + circuit breaker. Error hierarchy in a separate file. Pure function for recipe-to-text conversion. MSW-mocked tests.

**Tech Stack:** TypeScript, cockatiel (retry/circuit breaker), zod (response validation), msw (test mocking), vitest

**Scope:** 1 phase from original design (phase 1 of 1)

**Codebase verified:** 2026-03-19

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Error hierarchy

**Verifies:** None (infrastructure for AC3, AC4.2)

**Files:**

- Create: `src/features/embedding-errors.ts`

**Implementation:**

Create `src/features/embedding-errors.ts` with two error classes following the pattern established in `src/paprika/errors.ts`:

```typescript
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
```

**Verification:**

Run: `pnpm typecheck`
Expected: No errors

**Commit:** `feat(embeddings): add EmbeddingError and EmbeddingAPIError classes`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: EmbeddingClient and recipeToEmbeddingText

**Verifies:** None (implementation for all ACs, tested in Task 3)

**Files:**

- Create: `src/features/embeddings.ts`

**Implementation:**

Create `src/features/embeddings.ts` with the `EmbeddingClient` class and `recipeToEmbeddingText()` pure function. Follow cockatiel patterns from `src/paprika/client.ts:31-60` (resilience setup) and `src/paprika/client.ts:161-226` (request method pattern).

Key implementation details:

1. **Per-instance resilience stack** (same configuration values as PaprikaClient, but created in constructor to avoid shared state between instances):
   - Internal `TransientHTTPError` class (not exported, module-level) — signal for cockatiel
   - `RETRYABLE_STATUSES` set (module-level): `[429, 500, 502, 503]`
   - In the constructor, create and store as private readonly fields:
     - `_retryPolicy`: `retry(handleType(TransientHTTPError), { maxAttempts: 3, backoff: new ExponentialBackoff({ initialDelay: 500, maxDelay: 10_000 }) })`
     - `_breakerPolicy`: `circuitBreaker(handleType(TransientHTTPError), { halfOpenAfter: 30_000, breaker: new ConsecutiveBreaker(5) })`
     - `_resilience`: `wrap(this._retryPolicy, this._breakerPolicy)`
   - **Why per-instance:** Unlike PaprikaClient (singleton), multiple EmbeddingClient instances may exist in tests. Per-instance policies prevent circuit breaker state from leaking between test cases.

2. **Zod response schema** (module-internal, not exported):

```typescript
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

3. **EmbeddingClient class:**
   - Constructor accepts `Readonly<EmbeddingConfig>` (from `src/utils/config.ts:117`)
   - Strips trailing slash from `baseUrl` in constructor: `this._baseUrl = config.baseUrl.replace(/\/+$/, "")`
   - Stores `_apiKey`, `_baseUrl`, `_model` as private readonly fields
   - Private `_dimensions: number | null = null` for lazy caching
   - `get dimensions(): number` — returns `_dimensions` or throws `new EmbeddingError("Dimensions unknown: no embedding call has been made yet")` if null
   - `async embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>>`:
     - Builds endpoint URL: `${this._baseUrl}/embeddings`
     - Inner `execute` closure:
       - POSTs JSON body `{ model: this._model, input: texts }` with headers `{ "Content-Type": "application/json", "Authorization": "Bearer ${this._apiKey}" }`
       - Checks `response.ok` — if not: throws `TransientHTTPError` for retryable statuses, throws `EmbeddingAPIError` for permanent failures
       - Parses response JSON, validates with `EmbeddingResponseSchema.parse(json)`
       - Caches `_dimensions` from first embedding vector length
       - Returns `parsed.data.map((d) => d.embedding)`
     - Outer try/catch: catches `BrokenCircuitError` and maps to `new EmbeddingAPIError("Service unavailable (circuit open)", 503, endpoint)`
     - Re-throws any other error
   - `async embed(text: string): Promise<Array<number>>`:
     - Delegates to `embedBatch([text])` and returns first element: `const [first] = await this.embedBatch([text]); return first;`

4. **`recipeToEmbeddingText()` pure function:**
   - Signature: `function recipeToEmbeddingText(recipe: Readonly<Recipe>, categoryNames: ReadonlyArray<string>): string`
   - Import `type Recipe` from `../paprika/types.js`
   - Import `type EmbeddingConfig` from `../utils/config.js`
   - Builds sections array, including only non-null/non-empty fields:
     - Always: `recipe.name` (name is required, never null)
     - If `recipe.description` is non-null and non-empty: `"Description: {description}"`
     - If `categoryNames.length > 0`: `"Categories: {joined with ", "}"`
     - If `recipe.ingredients` is non-empty: `"Ingredients: {ingredients}"`
     - If `recipe.notes` is non-null and non-empty: `"Notes: {notes}"`
   - Explicitly excludes: `directions`, `nutritionalInfo`
   - Returns sections joined with `"\n\n"`

```typescript
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
```

**Verification:**

Run: `pnpm typecheck`
Expected: No errors

**Commit:** `feat(embeddings): add EmbeddingClient with cockatiel resilience and recipeToEmbeddingText`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->

### Task 3: EmbeddingClient tests

**Verifies:** p3-u03-embeddings.AC1.1, p3-u03-embeddings.AC1.2, p3-u03-embeddings.AC1.3, p3-u03-embeddings.AC1.4, p3-u03-embeddings.AC2.1, p3-u03-embeddings.AC2.2, p3-u03-embeddings.AC2.3, p3-u03-embeddings.AC3.1, p3-u03-embeddings.AC3.2, p3-u03-embeddings.AC3.3, p3-u03-embeddings.AC4.1, p3-u03-embeddings.AC4.2

**Files:**

- Create: `src/features/embeddings.test.ts`

**Implementation:**

Create `src/features/embeddings.test.ts` with MSW-mocked tests. Follow the MSW setup pattern from `src/paprika/client.test.ts:51-63`:

```typescript
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();

beforeAll(() => {
  server.listen();
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
```

Use the test naming convention `it("p3-u03-embeddings.AC{N}.{M} - {description}", ...)` as established in `src/paprika/client.test.ts`.

Helper function for generating valid embedding responses:

```typescript
const BASE_URL = "https://api.example.com/v1";
const API_KEY = "test-api-key";
const MODEL = "text-embedding-3-small";

function makeEmbeddingConfig(): EmbeddingConfig {
  return { apiKey: API_KEY, baseUrl: BASE_URL, model: MODEL };
}

function makeEmbeddingResponse(embeddings: Array<Array<number>>): object {
  return {
    data: embeddings.map((embedding, index) => ({ index, embedding, object: "embedding" })),
    model: MODEL,
    object: "list",
    usage: { prompt_tokens: 10, total_tokens: 10 },
  };
}
```

**Testing — each AC maps to a test:**

**AC1: EmbeddingClient sends correct requests**

- **p3-u03-embeddings.AC1.1:** `embedBatch(["a", "b", "c"])` — register MSW handler for `POST ${BASE_URL}/embeddings` that captures the request, verify request body has `{ model: MODEL, input: ["a", "b", "c"] }` and `Authorization: Bearer ${API_KEY}` header. Return valid response with 3 embeddings.
- **p3-u03-embeddings.AC1.2:** `embed("hello")` — verify it returns a single `number[]` (not nested array). Confirm only one POST made.
- **p3-u03-embeddings.AC1.3:** Construct client with `baseUrl: "https://api.example.com/v1/"` (trailing slash). Register handler on `https://api.example.com/v1/embeddings`. Verify request URL does NOT have double slash.
- **p3-u03-embeddings.AC1.4:** Register handler that returns valid JSON. Call `embedBatch`, verify parsed response has correct structure (arrays of numbers).

**AC2: Resilience handles transient failures**

- **p3-u03-embeddings.AC2.1:** Register handler that returns 429 on first call, then 200 on second. Call `embedBatch`, verify it succeeds (retry worked). Use a `let callCount = 0` variable incremented in handler.
- **p3-u03-embeddings.AC2.2:** Same pattern for 500, 502, 503 — register handler returning transient error first, then 200. Verify success on retry.
- **p3-u03-embeddings.AC2.3:** This test requires the circuit breaker to open after 5 consecutive transient failures. Create a **dedicated** `EmbeddingClient` instance for this test to avoid sharing state with other tests. Register handler that always returns 429. Call `embedBatch` repeatedly (wrapping each in try/catch) until 5+ failures. Then verify the next call throws `EmbeddingAPIError` with message containing "circuit open". Use a counter to verify the handler was NOT hit on the circuit-open call (i.e., the request count stays at the retry-exhausted count, not higher).

  **Note:** Because the resilience stack is per-instance (see Task 2), each `EmbeddingClient` has its own circuit breaker. Create a fresh client for this test and the circuit breaker state is isolated from other tests automatically.

**AC3: Error handling for permanent failures**

- **p3-u03-embeddings.AC3.1:** Register handler returning 400. Call `embedBatch`, verify it throws `EmbeddingAPIError` with `status: 400` and `endpoint` containing the URL. Verify no retry (handler called exactly once).
- **p3-u03-embeddings.AC3.2:** Register handler returning 401. Call `embedBatch`, verify it throws `EmbeddingAPIError` with `status: 401`. Verify no retry.
- **p3-u03-embeddings.AC3.3:** Register handler returning 200 with malformed JSON (`{ model: "x", usage: { prompt_tokens: 1, total_tokens: 1 } }` — missing `data` field). Call `embedBatch`, verify it throws `ZodError`.

**AC4: Dimensions getter**

- **p3-u03-embeddings.AC4.1:** Call `embed("test")` with handler returning a 4-dimensional vector `[0.1, 0.2, 0.3, 0.4]`. After the call, verify `client.dimensions === 4`.
- **p3-u03-embeddings.AC4.2:** Create fresh `EmbeddingClient`, immediately access `client.dimensions` — verify it throws `EmbeddingError` with message about no embedding call having been made.

**Verification:**

Run: `pnpm test src/features/embeddings.test.ts`
Expected: All tests pass

Run: `pnpm typecheck`
Expected: No errors

**Commit:** `test(embeddings): add MSW-mocked tests for EmbeddingClient`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: recipeToEmbeddingText tests

**Verifies:** p3-u03-embeddings.AC5.1, p3-u03-embeddings.AC5.2, p3-u03-embeddings.AC5.3, p3-u03-embeddings.AC5.4

**Files:**

- Modify: `src/features/embeddings.test.ts` (add new describe block)

**Implementation:**

Add a `describe("p3-u03-embeddings.AC5: recipeToEmbeddingText", ...)` block to the existing test file. Use `makeRecipe()` from `src/cache/__fixtures__/recipes.ts` for test data.

**Testing — each AC maps to a test:**

- **p3-u03-embeddings.AC5.1:** Create a recipe with `makeRecipe({ name: "Pasta Carbonara", description: "Classic Italian pasta", ingredients: "spaghetti, eggs, pancetta", notes: "Use fresh eggs" })` and category names `["Italian", "Pasta"]`. Call `recipeToEmbeddingText(recipe, categoryNames)`. Verify output includes all five: recipe name, description text, "Categories: Italian, Pasta", ingredients text, notes text.
- **p3-u03-embeddings.AC5.2:** Using the same recipe, verify the output does NOT include `directions` text. Set `directions: "Boil water, cook pasta"` and confirm it's absent from output.
- **p3-u03-embeddings.AC5.3:** Create a recipe with `makeRecipe({ name: "Simple Recipe", description: null, notes: null, ingredients: "" })` and empty category names `[]`. Call `recipeToEmbeddingText`. Verify output is just `"Simple Recipe"` — no "Description:", "Categories:", "Ingredients:", or "Notes:" lines, no blank lines.
- **p3-u03-embeddings.AC5.4:** Create a recipe with `makeRecipe({ name: "Test", ingredients: "flour" })` and pass `[]` as category names. Verify output does not contain "Categories:".

**Verification:**

Run: `pnpm test src/features/embeddings.test.ts`
Expected: All tests pass

**Commit:** `test(embeddings): add recipeToEmbeddingText tests`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->

### Task 5: Final verification

**Verifies:** All ACs (full suite)

**Files:** None (verification only)

**Verification:**

Run: `pnpm typecheck`
Expected: No errors

Run: `pnpm lint`
Expected: No errors or warnings

Run: `pnpm test`
Expected: All tests pass (including pre-existing tests)

**Commit:** None (verification only — commit only if lint:fix was needed)

<!-- END_TASK_5 -->
