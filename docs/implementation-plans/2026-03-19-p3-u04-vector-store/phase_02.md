# Vector Store Implementation Plan — Phase 2

**Goal:** Comprehensive test coverage for VectorStore — unit tests with mocked Vectra, integration tests with real Vectra in temp directories, and final verification.

**Architecture:** Two test tiers: unit tests mock `vectra` and `EmbeddingClient` to test VectorStore logic in isolation (hash filtering, batch flow, corruption recovery); integration tests use real Vectra `LocalIndex` in temp directories with a deterministic mock `EmbeddingClient` to verify end-to-end indexing and search.

**Tech Stack:** vitest, vi.mock (module mocking), fast-check (property-based tests for contentHash), node:fs/promises (temp dir setup/teardown)

**Scope:** 2 of 2 phases from original design (Phase 2)

**Codebase verified:** 2026-03-20

**Project-specific guidance:** `/home/brajkovic/Projects/mcp-paprika/.ed3d/implementation-plan-guidance.md`

**Testing guidance:** CLAUDE.md (lines 78-85); test patterns in `src/cache/disk-cache.test.ts` (temp dirs via mkdtemp), `src/features/embeddings.test.ts` (MSW HTTP mocking), `src/tools/tool-test-utils.ts` (factory helpers), `src/cache/__fixtures__/recipes.ts` (recipe fixtures with `makeRecipe()`)

---

## Acceptance Criteria Coverage

This phase tests all ACs:

### p3-u04-vector-store.AC1: Initialization

- **p3-u04-vector-store.AC1.1 Success:** `init()` creates the Vectra index and empty hash map when neither exists (first run)
- **p3-u04-vector-store.AC1.2 Success:** `init()` loads existing hash map and opens existing Vectra index on subsequent runs
- **p3-u04-vector-store.AC1.3 Edge:** `init()` recovers from corrupted `hash-index.json` -- logs to stderr, backs up to `.bak`, resets to empty map
- **p3-u04-vector-store.AC1.4 Edge:** `init()` recovers from corrupted Vectra index -- logs to stderr, backs up `vectors/` to `vectors.bak/`, recreates index, clears hash map

### p3-u04-vector-store.AC2: Indexing with hash-based dedup

- **p3-u04-vector-store.AC2.1 Success:** `indexRecipes()` embeds and upserts recipes whose content hash has changed
- **p3-u04-vector-store.AC2.2 Success:** `indexRecipes()` skips recipes whose `contentHash(recipeToEmbeddingText(...))` matches the persisted value
- **p3-u04-vector-store.AC2.3 Success:** `indexRecipes()` returns `IndexingResult` with correct `indexed`, `skipped`, and `total` counts
- **p3-u04-vector-store.AC2.4 Success:** `indexRecipes()` persists updated hash map to `hash-index.json` after successful indexing
- **p3-u04-vector-store.AC2.5 Edge:** `indexRecipes([])` returns `{ indexed: 0, skipped: 0, total: 0 }` without calling embedBatch
- **p3-u04-vector-store.AC2.6 Edge:** Hash map persists across restarts -- new VectorStore instance loads previously saved hashes and skips unchanged recipes

### p3-u04-vector-store.AC3: Search

- **p3-u04-vector-store.AC3.1 Success:** `search(query, topK)` embeds the query and returns `SemanticResult[]` with uid, score, and recipeName
- **p3-u04-vector-store.AC3.2 Success:** Results are ordered by descending cosine similarity score
- **p3-u04-vector-store.AC3.3 Edge:** `search()` on empty index returns `[]` (not an error)

### p3-u04-vector-store.AC4: Removal

- **p3-u04-vector-store.AC4.1 Success:** `removeRecipe(uid)` deletes the item from Vectra and removes the uid from the hash map
- **p3-u04-vector-store.AC4.2 Success:** `removeRecipe(uid)` persists the updated hash map after removal
- **p3-u04-vector-store.AC4.3 Edge:** `removeRecipe(uid)` for a non-existent uid does not throw

### p3-u04-vector-store.AC5: Content hashing

- **p3-u04-vector-store.AC5.1 Success:** `contentHash()` produces a stable SHA-256 hex digest for the same input text
- **p3-u04-vector-store.AC5.2 Success:** A change to only `directions` (excluded from embedding text) does not change the content hash
- **p3-u04-vector-store.AC5.3 Success:** A change to `ingredients` (included in embedding text) does change the content hash

---

## Codebase Verification Findings (Testing Patterns)

- ✓ Tests colocated as `src/**/*.test.ts` — 23 files, 390 tests
- ✓ `vi.mock('module')` pattern used extensively (e.g., `src/tools/create.test.ts`)
- ✓ `vi.fn()` with `.mockResolvedValue()`, `.mockReturnValue()`, `.mockImplementation()`
- ✓ Temp dirs: `mkdtemp(join(tmpdir(), "paprika-disk-cache-"))` with `rm(tempDir, { recursive: true, force: true })` in afterEach (`src/cache/disk-cache.test.ts:10-20`)
- ✓ Recipe fixtures: `makeRecipe(overrides?)` at `src/cache/__fixtures__/recipes.ts:7-41`
- ✓ stderr spying: `vi.spyOn(process.stderr, "write").mockReturnValue(true)` (`src/cache/disk-cache.test.ts:79`)
- ✓ No integration tests exist yet — Phase 2 will create the first `*.test.integration.ts` file
- ✓ Property-based tests use fast-check with `fc.property()` and typed arbitraries

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Unit tests for contentHash and VectorStoreError

**Verifies:** p3-u04-vector-store.AC5.1, p3-u04-vector-store.AC5.2, p3-u04-vector-store.AC5.3

**Files:**

- Create: `src/features/vector-store.test.ts`

**Implementation:**

Create the unit test file starting with tests for the `contentHash` pure function and `VectorStoreError` class.

`contentHash` tests verify:

- AC5.1: Same input → same SHA-256 hex digest (64-char hex string)
- AC5.2: Changing `directions` (excluded by `recipeToEmbeddingText`) does not change hash
- AC5.3: Changing `ingredients` (included by `recipeToEmbeddingText`) does change hash

For AC5.2 and AC5.3, use `makeRecipe()` from `src/cache/__fixtures__/recipes.ts` to create two recipe variants, run each through `recipeToEmbeddingText()`, then `contentHash()`, and compare.

`VectorStoreError` tests verify:

- Extends `Error`
- Has `name` set to `"VectorStoreError"`
- Supports `ErrorOptions` cause chaining

**Testing:**

- AC5.1: Call `contentHash("hello")` twice, assert same 64-char hex result
- AC5.2: `makeRecipe({ directions: "A" })` vs `makeRecipe({ directions: "B" })` — both produce same hash via `contentHash(recipeToEmbeddingText(recipe, []))`
- AC5.3: `makeRecipe({ ingredients: "flour" })` vs `makeRecipe({ ingredients: "sugar" })` — produce different hashes

**Verification:**
Run: `pnpm test src/features/vector-store.test.ts`
Expected: All tests pass

**Commit:** `test(vector-store): add contentHash and VectorStoreError tests (p3-u04)`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Property-based tests for contentHash

**Verifies:** p3-u04-vector-store.AC5.1

**Files:**

- Create: `src/features/vector-store.property.test.ts`

**Implementation:**

Property-based tests for `contentHash` using fast-check:

1. **Determinism:** For any string input, `contentHash(s) === contentHash(s)` (stability property)
2. **Format:** Output is always a 64-character hex string (`/^[0-9a-f]{64}$/`)
3. **Sensitivity:** For any two distinct non-empty strings `a !== b`, `contentHash(a) !== contentHash(b)` (collision resistance — use `fc.pre(a !== b)` to filter)

Use `fc.string()` arbitrary for inputs. Include `@example` for empty string edge case.

**Testing:**

Follow pattern from `src/utils/duration.property.test.ts` — import `fc` from `fast-check`, use `fc.assert(fc.property(...))`.

**Verification:**
Run: `pnpm test src/features/vector-store.property.test.ts`
Expected: All tests pass

**Commit:** `test(vector-store): add property-based tests for contentHash (p3-u04)`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->

### Task 3: Unit tests for VectorStore init and corruption recovery

**Verifies:** p3-u04-vector-store.AC1.1, p3-u04-vector-store.AC1.2, p3-u04-vector-store.AC1.3, p3-u04-vector-store.AC1.4

**Files:**

- Modify: `src/features/vector-store.test.ts` (add init test suite)

**Implementation:**

Add a `describe("VectorStore init")` block. These are unit tests using `vi.mock("vectra")` to mock `LocalIndex` and real temp directories for hash map file operations.

**Mock setup pattern:**

```typescript
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock vectra's LocalIndex
vi.mock("vectra", () => {
  const MockLocalIndex = vi.fn();
  MockLocalIndex.prototype.isIndexCreated = vi.fn();
  MockLocalIndex.prototype.createIndex = vi.fn();
  MockLocalIndex.prototype.beginUpdate = vi.fn();
  MockLocalIndex.prototype.endUpdate = vi.fn();
  MockLocalIndex.prototype.cancelUpdate = vi.fn();
  MockLocalIndex.prototype.upsertItem = vi.fn();
  MockLocalIndex.prototype.deleteItem = vi.fn();
  MockLocalIndex.prototype.queryItems = vi.fn();
  return { LocalIndex: MockLocalIndex };
});
```

Each test gets a fresh temp directory via `mkdtemp` and cleans up in `afterEach` with `rm({ recursive: true, force: true })`. Create a mock `EmbeddingClient` with `vi.fn()` stubs for `embed` and `embedBatch`.

**Tests:**

- AC1.1 (first run): No hash-index.json on disk, `isIndexCreated()` returns false → `createIndex()` called, `size` is 0
- AC1.2 (subsequent run): Write valid hash-index.json to disk before init → loaded, `size` matches entries, `isIndexCreated()` returns true → `createIndex()` NOT called
- AC1.3 (corrupt hash JSON): Write invalid JSON to hash-index.json → init succeeds, stderr contains warning, `.bak` file created, `size` is 0
- AC1.3 (corrupt hash schema): Write `{"not": "valid"}` → same recovery behavior
- AC1.4 (corrupt Vectra index): `isIndexCreated()` returns true but throws on subsequent operation → stderr warning, index recreated with `deleteIfExists: true`, hash map cleared

For stderr assertions, use `vi.spyOn(process.stderr, "write").mockReturnValue(true)` and check that the spy was called with a string containing the expected message.

**Verification:**
Run: `pnpm test src/features/vector-store.test.ts`
Expected: All tests pass

**Commit:** `test(vector-store): add init and corruption recovery tests (p3-u04)`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Unit tests for indexRecipes, search, removeRecipe

**Verifies:** p3-u04-vector-store.AC2.1, p3-u04-vector-store.AC2.2, p3-u04-vector-store.AC2.3, p3-u04-vector-store.AC2.4, p3-u04-vector-store.AC2.5, p3-u04-vector-store.AC3.1, p3-u04-vector-store.AC3.2, p3-u04-vector-store.AC3.3, p3-u04-vector-store.AC4.1, p3-u04-vector-store.AC4.2, p3-u04-vector-store.AC4.3

**Files:**

- Modify: `src/features/vector-store.test.ts` (add indexRecipes, search, removeRecipe test suites)

**Implementation:**

Add `describe("VectorStore indexRecipes")`, `describe("VectorStore search")`, and `describe("VectorStore removeRecipe")` blocks. Uses the same `vi.mock("vectra")` setup from Task 3.

**Test setup helper:** Create a helper that initializes VectorStore in a temp dir with mocked Vectra and EmbeddingClient:

```typescript
function makeMockEmbedder() {
  return {
    embed: vi.fn<(text: string) => Promise<Array<number>>>(),
    embedBatch: vi.fn<(texts: ReadonlyArray<string>) => Promise<Array<Array<number>>>>(),
    get dimensions() {
      return 3;
    },
  } as unknown as EmbeddingClient;
}
```

Use `makeRecipe()` from `src/cache/__fixtures__/recipes.ts` for test recipes.

**indexRecipes tests:**

- AC2.1: Pass 2 recipes, `embedBatch` returns 2 vectors, verify `upsertItem` called twice with correct `id`, `vector`, and `metadata.recipeName`
- AC2.2: Index a recipe, then call `indexRecipes` again with same recipe (unchanged) → `embedBatch` NOT called, result has `skipped: 1`
- AC2.3: Index 3 recipes (2 new, 1 unchanged) → result is `{ indexed: 2, skipped: 1, total: 3 }`
- AC2.4: After indexing, read `hash-index.json` from temp dir → contains entries for indexed recipes
- AC2.5: `indexRecipes([])` → returns `{ indexed: 0, skipped: 0, total: 0 }`, `embedBatch` NOT called
- AC2.6: Index recipes, create new VectorStore instance with same temp dir, call `init()`, index same recipes again → all skipped (hashes loaded from disk)

**search tests:**

- AC3.1: Mock `embed()` to return `[1, 0, 0]`, mock `queryItems()` to return result items with `score` and `metadata.recipeName` → verify `SemanticResult[]` shape
- AC3.2: Mock `queryItems()` returns items in descending score order → verify output order matches
- AC3.3: Mock `queryItems()` returns `[]` → `search()` returns `[]`

**removeRecipe tests:**

- AC4.1: After indexing, call `removeRecipe(uid)` → `deleteItem(uid)` called, hash map no longer contains uid
- AC4.2: After removal, read `hash-index.json` → uid absent
- AC4.3: Call `removeRecipe("nonexistent")` → does not throw (Vectra's `deleteItem` silently no-ops)

**Verification:**
Run: `pnpm test src/features/vector-store.test.ts`
Expected: All tests pass

**Commit:** `test(vector-store): add indexRecipes, search, and removeRecipe unit tests (p3-u04)`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->

<!-- START_TASK_5 -->

### Task 5: Integration tests with real Vectra

**Verifies:** p3-u04-vector-store.AC1.1, p3-u04-vector-store.AC2.1, p3-u04-vector-store.AC2.2, p3-u04-vector-store.AC2.6, p3-u04-vector-store.AC3.1, p3-u04-vector-store.AC3.2, p3-u04-vector-store.AC4.1

**Files:**

- Create: `src/features/vector-store.test.integration.ts`

**Implementation:**

Integration tests use real Vectra `LocalIndex` (NO `vi.mock("vectra")`) in real temp directories. `EmbeddingClient` is mocked with deterministic vectors — each text maps to a known vector. This tests the full indexing → search → removal pipeline end-to-end.

**Deterministic mock embedder:**

The mock embedder should return deterministic vectors that produce distinguishable cosine similarity scores. For example, use simple unit vectors along different axes:

```typescript
// Deterministic embedder: returns a vector based on text content
// This ensures search results are predictable
function makeDeterministicEmbedder(): EmbeddingClient {
  return {
    embed: vi.fn(async (text: string) => textToVector(text)),
    embedBatch: vi.fn(async (texts: ReadonlyArray<string>) => texts.map((t) => textToVector(t))),
    get dimensions() {
      return 3;
    },
  } as unknown as EmbeddingClient;
}

// Simple hash-based vector generation for deterministic results
function textToVector(text: string): Array<number> {
  // Use a simple deterministic mapping
  const hash = createHash("md5").update(text).digest();
  const x = hash.readUInt8(0) / 255;
  const y = hash.readUInt8(1) / 255;
  const z = hash.readUInt8(2) / 255;
  const norm = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / norm, y / norm, z / norm];
}
```

**Tests:**

- **Full pipeline:** Create VectorStore with temp dir, `init()`, index 3 recipes, search with a query, verify results contain recipe names and scores
- **Dedup across restarts (AC2.6):** Index recipes, create new VectorStore on same dir, init, index same recipes → all skipped (hash persistence works end-to-end)
- **Search returns ordered results (AC3.2):** Index recipes with different content, search with query close to one recipe → first result has highest score
- **Removal removes from search (AC4.1):** Index 2 recipes, remove one, search → only remaining recipe found
- **First-run creates index (AC1.1):** Init on empty temp dir, verify `vectors/` directory and `index.json` created

Each test uses `mkdtemp` for isolation and `rm` in `afterEach` for cleanup.

**Verification:**
Run: `pnpm test src/features/vector-store.test.integration.ts`
Expected: All tests pass

**Commit:** `test(vector-store): add integration tests with real Vectra (p3-u04)`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->

### Task 6: Final verification

**Verifies:** All ACs (final check)

**Files:**

- No new files

**Implementation:**

Run the full verification suite to confirm everything works together.

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm lint`
Expected: No lint errors or warnings

Run: `pnpm test`
Expected: All tests pass (existing 390 + new vector-store tests)

Run: `pnpm format:check`
Expected: No formatting issues (run `pnpm format` first if needed)

**Commit:** No commit needed if everything passes. If formatting fixes are required:

**Commit:** `style(vector-store): format vector-store files (p3-u04)`

<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->
