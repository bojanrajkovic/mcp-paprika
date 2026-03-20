# Embedding Provider Configuration

The `EmbeddingClient` works with any OpenAI-compatible `/v1/embeddings` endpoint.
Three environment variables control provider selection:

| Variable          | Description                                   | Example                         |
| ----------------- | --------------------------------------------- | ------------------------------- |
| `OPENAI_BASE_URL` | Base URL for the embeddings API (up to `/v1`) | `https://openrouter.ai/api/v1`  |
| `OPENAI_API_KEY`  | Bearer token for authentication               | `sk-or-v1-...`                  |
| `EMBEDDING_MODEL` | Model identifier (provider-specific)          | `openai/text-embedding-3-small` |

## Provider Examples

### Local development: ollama (free, no network)

Run embedding models locally on CPU. No API key needed. Good for offline
development and fast iteration.

```bash
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
EMBEDDING_MODEL=nomic-embed-text
```

**Setup:**

```bash
# Install ollama (if not already installed)
curl -fsSL https://ollama.com/install.sh | sh

# Pull the embedding model (~274 MB download)
ollama pull nomic-embed-text

# ollama serves an OpenAI-compatible API on :11434 automatically
```

**Recommended local models:**

| Model                    | Size   | Dimensions | Context | Notes                             |
| ------------------------ | ------ | ---------- | ------- | --------------------------------- |
| `nomic-embed-text`       | 274 MB | 768        | 8K      | Best balance of quality and speed |
| `all-minilm`             | 45 MB  | 384        | 512     | Smallest/fastest, limited context |
| `mxbai-embed-large`      | 670 MB | 1024       | 512     | Higher quality, larger            |
| `snowflake-arctic-embed` | 670 MB | 1024       | 512     | Strong retrieval performance      |

No GPU required — embedding models are small enough to run on CPU. The Ryzen 7
with AVX2 handles these comfortably.

### Testing / CI: OpenRouter + text-embedding-3-small

Cheap and reliable. Good for CI pipelines and integration tests.

```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-v1-...
EMBEDDING_MODEL=openai/text-embedding-3-small
```

- $0.02 per million tokens
- 1536 dimensions, 8K context
- Consistent latency, no rate limit surprises

### Production: OpenRouter + text-embedding-3-large

Best semantic quality for recipe search.

```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-v1-...
EMBEDDING_MODEL=openai/text-embedding-3-large
```

- $0.13 per million tokens
- 3072 dimensions, 8K context
- Supports dimension reduction (request fewer dims to trade quality for storage)

### Free tier: OpenRouter + NVIDIA Nemotron

Free but rate-limited. Useful for casual testing.

```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-v1-...
EMBEDDING_MODEL=nvidia/llama-nemotron-embed-vl-1b-v2
```

- Free (promotional, may change)
- 131K context, multimodal (text + image)
- Aggressive rate limits — cockatiel retry/429 handling will fire often

### Direct OpenAI (no OpenRouter)

If you prefer to hit OpenAI directly:

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```

Note: model names differ — OpenRouter uses `openai/text-embedding-3-small`,
direct OpenAI uses `text-embedding-3-small` (no provider prefix).

## Integration Testing with ollama

For future integration tests that hit a real embedding endpoint (rather than
MSW mocks), ollama provides a local, deterministic, free API:

```bash
# Start ollama if not running
ollama serve &

# Verify the embedding endpoint works
curl -s http://localhost:11434/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "nomic-embed-text", "input": "test"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'dims={len(d[\"data\"][0][\"embedding\"])}')"
# Expected: dims=768
```

Integration tests should be gated behind an environment variable (e.g.,
`OLLAMA_AVAILABLE=1`) so CI can skip them when ollama isn't present.
