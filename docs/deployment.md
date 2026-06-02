# Deployment (HTTP transport)

The published container image defaults to `MCP_TRANSPORT=http`, so a container run
needs the same OAuth environment that [quick-start-http.md](quick-start-http.md) walks
through: `MCP_PUBLIC_URL`, an OIDC preset (or discovery URL), upstream client
credentials, and a non-empty allowlist. Without those, the server exits during config
validation. With OAuth built in, the remaining concerns are TLS termination and, if you
want them, network-layer controls.

## Pull and run

Pull the published image (multi-arch: `linux/amd64`, `linux/arm64`):

```bash
docker pull ghcr.io/bojanrajkovic/mcp-paprika:latest

docker run --rm \
  -e PAPRIKA_EMAIL=you@example.com \
  -e PAPRIKA_PASSWORD=your-password \
  -e MCP_PUBLIC_URL=https://mcp.example.com \
  -e MCP_OIDC_PRESET=google \
  -e MCP_OIDC_CLIENT_ID=123456789-abc.apps.googleusercontent.com \
  -e MCP_OIDC_CLIENT_SECRET=GOCSPX-... \
  -e MCP_ALLOWED_EMAILS=you@example.com \
  -v "$(pwd)/data:/data" \
  -p 3000:3000 \
  ghcr.io/bojanrajkovic/mcp-paprika:latest
```

Contributors building from source can run `docker build -t mcp-paprika:dev .` and
substitute `mcp-paprika:dev` for the image reference.

## Verify the image before running it

The image is signed with [sigstore/cosign](https://github.com/sigstore/cosign) keyless
OIDC and ships SLSA build provenance plus an SPDX SBOM as OCI attestations. Verify both
before running in untrusted environments; [releasing.md](releasing.md#verifying-a-published-image)
has the exact `gh attestation verify` and `cosign verify` commands, along with the
cosign 2.5+ version requirement.

## Data persistence

The HTTP-mode image binds on `0.0.0.0:3000` and persists the disk cache and vector
index under `/data`, the documented mount point. Both `/data` sub-directories
(`config/`, `cache/`) are pre-created with `nonroot` (UID 65532) ownership in the image,
so writes work the first time even on a fresh bind-mount.

If you bind-mount a host directory you created as root, pre-chown it:

```bash
mkdir -p ./data && sudo chown -R 65532:65532 ./data
```

Or use a named volume, where Docker handles ownership automatically:

```bash
docker run --rm \
  -e PAPRIKA_EMAIL=... -e PAPRIKA_PASSWORD=... \
  -v mcp-paprika-data:/data \
  -p 3000:3000 \
  ghcr.io/bojanrajkovic/mcp-paprika:latest
```

## Smoke test (stdio)

For a one-shot check that the image launches, with no OAuth and no remote clients,
override the transport to `stdio`. This turns the container into a CLI process that
speaks MCP on stdin/stdout, so the port mapping goes unused:

```bash
docker run --rm -i \
  -e MCP_TRANSPORT=stdio \
  -e PAPRIKA_EMAIL=you@example.com \
  -e PAPRIKA_PASSWORD=your-password \
  -v "$(pwd)/data:/data" \
  ghcr.io/bojanrajkovic/mcp-paprika:latest
```

The image also declares a `HEALTHCHECK` that hits `GET /healthz`:

```bash
docker inspect --format '{{.State.Health.Status}}' <container>
# → healthy
```

## TLS termination

TLS is required: `MCP_PUBLIC_URL` must be `https://`, and OAuth requires encrypted
connections end to end. Three approaches:

- **Reverse proxy with TLS** (nginx / Caddy): terminates TLS, passes `X-Forwarded-For`
  (required for rate limiting; pair it with `MCP_TRUST_PROXY=true`), and forwards to the
  container on a private port.
- **Cloudflare Tunnel:** no inbound port exposed; Cloudflare terminates TLS. Pairs well
  with Cloudflare Access for an extra authentication layer.
- **Tailscale HTTPS:** Tailscale's built-in cert provisioning, suitable for a homelab
  where every client is on your tailnet.

OAuth provides the authentication controls; the reverse proxy provides TLS, rate
limiting, and any network-level restrictions the deployment requires.

## Docker Compose

```yaml
services:
  mcp-paprika:
    image: ghcr.io/bojanrajkovic/mcp-paprika:latest
    environment:
      MCP_TRANSPORT: http
      MCP_PUBLIC_URL: https://mcp.example.com
      MCP_OIDC_PRESET: google
      MCP_OIDC_CLIENT_ID: "<your-client-id>"
      MCP_OIDC_CLIENT_SECRET: "<your-client-secret>"
      MCP_ALLOWED_EMAILS: "you@example.com"
      PAPRIKA_EMAIL: "you@example.com"
      PAPRIKA_PASSWORD: "<your-paprika-password>"
    volumes:
      - mcp-paprika-data:/data
    ports:
      - "127.0.0.1:3000:3000"

volumes:
  mcp-paprika-data:
```

For Kubernetes, the [`k8s/`](../k8s/) kustomization is a ready-made manifest set; its
README covers the secret, PVC, and ingress wiring.
