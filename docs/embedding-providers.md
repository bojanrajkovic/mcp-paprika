# Embedding provider configuration

The `discover_recipes` tool uses embeddings for semantic search. It works with any OpenAI-compatible `/v1/embeddings` endpoint.

Three config values control provider selection. Set them as environment variables or in `config.json` (see [configuration](configuration.md) for the full config reference):

| Env var           | config.json path              | Description            | Example                         |
| ----------------- | ----------------------------- | ---------------------- | ------------------------------- |
| `OPENAI_BASE_URL` | `features.embeddings.baseUrl` | Base URL (up to `/v1`) | `https://openrouter.ai/api/v1`  |
| `OPENAI_API_KEY`  | `features.embeddings.apiKey`  | Bearer token           | `sk-or-v1-...`                  |
| `EMBEDDING_MODEL` | `features.embeddings.model`   | Model identifier       | `openai/text-embedding-3-small` |

All three must be set to enable semantic search. If any are missing, the server starts without `discover_recipes`.

## Provider examples

### Local development: Ollama (free, no network)

Run embedding models locally on CPU. No API key needed.

**Environment variables:**

```bash
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
EMBEDDING_MODEL=nomic-embed-text
```

**config.json equivalent:**

```json
{
  "features": {
    "embeddings": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "model": "nomic-embed-text"
    }
  }
}
```

**Setup:**

```bash
# Install ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the embedding model (~274 MB)
ollama pull nomic-embed-text

# ollama serves an OpenAI-compatible API on :11434 automatically
```

**Recommended local models:**

| Model                    | Size   | Dimensions | Context | Notes                                 |
| ------------------------ | ------ | ---------- | ------- | ------------------------------------- |
| `nomic-embed-text`       | 274 MB | 768        | 8K      | Best balance of quality and speed     |
| `all-minilm`             | 45 MB  | 384        | 512     | Smallest and fastest, limited context |
| `mxbai-embed-large`      | 670 MB | 1024       | 512     | Higher quality, larger                |
| `snowflake-arctic-embed` | 670 MB | 1024       | 512     | Strong retrieval performance          |

No GPU required — embedding models are small enough to run on CPU.

### Testing / CI: OpenRouter + text-embedding-3-small

Cheap and reliable. Good for CI pipelines and integration tests.

```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-v1-...
EMBEDDING_MODEL=openai/text-embedding-3-small
```

```json
{
  "features": {
    "embeddings": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-v1-...",
      "model": "openai/text-embedding-3-small"
    }
  }
}
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

```json
{
  "features": {
    "embeddings": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-v1-...",
      "model": "openai/text-embedding-3-large"
    }
  }
}
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

```json
{
  "features": {
    "embeddings": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-v1-...",
      "model": "nvidia/llama-nemotron-embed-vl-1b-v2"
    }
  }
}
```

- Free (promotional, may change)
- 131K context, multimodal (text + image)
- Aggressive rate limits — the retry logic will fire often

### Direct OpenAI (no OpenRouter)

If you prefer to hit OpenAI directly:

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```

```json
{
  "features": {
    "embeddings": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "model": "text-embedding-3-small"
    }
  }
}
```

Note: model names differ — OpenRouter uses `openai/text-embedding-3-small`, direct OpenAI uses `text-embedding-3-small` (no provider prefix).

## Integration testing with Ollama

For integration tests that hit a real embedding endpoint (rather than mocks), Ollama provides a local, deterministic, free API:

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

Integration tests are gated behind Ollama availability — they skip gracefully when Ollama isn't running.
