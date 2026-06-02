# Embedding provider configuration

The `discover_recipes` tool uses embeddings for semantic search, and works with any
OpenAI-compatible `/v1/embeddings` endpoint. Three values select the provider; set them
as environment variables or in `config.json` (see [configuration.md](configuration.md)
for the full config reference):

| Env var           | config.json path              | Description            | Example                         |
| ----------------- | ----------------------------- | ---------------------- | ------------------------------- |
| `OPENAI_BASE_URL` | `features.embeddings.baseUrl` | Base URL (up to `/v1`) | `https://openrouter.ai/api/v1`  |
| `OPENAI_API_KEY`  | `features.embeddings.apiKey`  | Bearer token           | `sk-or-v1-...`                  |
| `EMBEDDING_MODEL` | `features.embeddings.model`   | Model identifier       | `openai/text-embedding-3-small` |

Set all three together to enable semantic search. If any are missing, the server starts
without `discover_recipes`.

## Provider matrix

Pick a row and copy its three values into the variables above. The API key format
follows the provider: `sk-or-v1-...` for OpenRouter, `sk-...` for direct OpenAI, and any
non-empty string for Ollama (which ignores it).

| Use case        | `OPENAI_BASE_URL`              | `EMBEDDING_MODEL`                      | Dims | Context | Cost         | Notes                              |
| --------------- | ------------------------------ | -------------------------------------- | ---- | ------- | ------------ | ---------------------------------- |
| Local / offline | `http://localhost:11434/v1`    | `nomic-embed-text`                     | 768  | 8K      | free         | Ollama; runs on CPU                |
| Testing / CI    | `https://openrouter.ai/api/v1` | `openai/text-embedding-3-small`        | 1536 | 8K      | ~$0.02/M tok | consistent latency                 |
| Production      | `https://openrouter.ai/api/v1` | `openai/text-embedding-3-large`        | 3072 | 8K      | ~$0.13/M tok | supports dimension reduction       |
| Free tier       | `https://openrouter.ai/api/v1` | `nvidia/llama-nemotron-embed-vl-1b-v2` | —    | 131K    | free (promo) | multimodal; aggressive rate limits |
| Direct OpenAI   | `https://api.openai.com/v1`    | `text-embedding-3-small`               | 1536 | 8K      | ~$0.02/M tok | no `openai/` model prefix          |

OpenRouter prefixes model names with the provider (`openai/text-embedding-3-small`);
direct OpenAI drops the prefix (`text-embedding-3-small`). The Nemotron free tier is
promotional and rate-limits hard, so the client's retry logic fires often.

A worked Ollama configuration, as environment variables:

```bash
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
EMBEDDING_MODEL=nomic-embed-text
```

The same thing in `config.json`:

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

Swap the three values for any other row in the matrix.

## Running Ollama locally

Ollama runs embedding models on CPU with no API key and no network, which makes it the
easy default for local development and integration tests.

```bash
# Install ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the embedding model (~274 MB)
ollama pull nomic-embed-text

# ollama serves an OpenAI-compatible API on :11434 automatically
```

Recommended local models:

| Model                    | Size   | Dimensions | Context | Notes                                 |
| ------------------------ | ------ | ---------- | ------- | ------------------------------------- |
| `nomic-embed-text`       | 274 MB | 768        | 8K      | Best balance of quality and speed     |
| `all-minilm`             | 45 MB  | 384        | 512     | Smallest and fastest, limited context |
| `mxbai-embed-large`      | 670 MB | 1024       | 512     | Higher quality, larger                |
| `snowflake-arctic-embed` | 670 MB | 1024       | 512     | Strong retrieval performance          |

No GPU required: these models are small enough to run on CPU.

## Integration testing with Ollama

For integration tests that hit a real embedding endpoint rather than mocks, Ollama
provides a local, deterministic, free API:

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

Integration tests are gated behind Ollama availability: they skip gracefully when Ollama
isn't running.
