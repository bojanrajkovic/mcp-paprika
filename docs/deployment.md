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
before running in untrusted environments; [releasing.md](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/releasing.md#verifying-a-published-image)
has the exact `gh attestation verify` and `cosign verify` commands, along with the
cosign 2.5+ version requirement.

## Data persistence

The HTTP-mode image binds on `0.0.0.0:3000` and persists the disk cache and vector
index under `/data`, the documented mount point. Both `/data` sub-directories
(`config/`, `cache/`) are pre-created with `nonroot` (UID 65532) ownership in the image.
A named volume inherits that ownership when Docker first populates it, so writes work out
of the box. A bind mount is different: the host directory is layered over `/data` and
hides the image-created dirs, so a host directory owned by root (or by your user) stays
unwritable by UID 65532 until you chown it.

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
- **Tailscale Funnel:** exposes the server publicly over HTTPS with a Tailscale-managed
  cert and no inbound port to open, the homelab-friendly way to give claude.ai a
  reachable `MCP_PUBLIC_URL`. Set `MCP_TRUST_PROXY=true`, since Funnel forwards the
  client address. (Plain Tailscale Serve keeps the service on your tailnet, which a
  remote client like claude.ai can't reach.)

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

For Kubernetes, the [`k8s/`](https://github.com/bojanrajkovic/mcp-paprika/tree/main/k8s) kustomization is a ready-made manifest set; its
README covers the secret, PVC, and ingress wiring.

## Kubernetes operational notes

Two non-obvious constraints when running the HTTP image in Kubernetes:

- **`Recreate`, not `RollingUpdate`.** The disk cache and vector index live on a single
  `ReadWriteOnce` `/data` PVC, which two pods cannot co-mount, so the Deployment must use
  `strategy: Recreate` — the old pod is torn down before the new one starts. There is no
  rolling overlap and no canary: a bad or un-startable image is a **full outage**, not a
  degraded-but-up service. Roll a new image with
  `kubectl -n <namespace> set image deployment/mcp-paprika mcp-paprika=<image>` and watch the
  single pod come up before assuming success.
- **Startup authentication fails fast.** The server authenticates to the Paprika API once at
  startup and treats a failure as fatal (it does not retry forever). A _transient_ egress
  blip to the Paprika API during a rollout can therefore wedge the new pod in
  `CrashLoopBackOff` even when the image is fine. Before blaming the image, confirm egress to
  the Paprika API is healthy, then force a fresh pod during a good window.
