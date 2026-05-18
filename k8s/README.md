# Kubernetes manifests

Deploys mcp-paprika to the k3s homelab (`default` kubectl context).

- **Storage:** `longhorn-ssd` (distributed; PVC survives node moves)
- **Ingress:** **none yet** — the server has no built-in MCP auth, and Anthropic's MCP clients (Claude Mobile / Desktop / Code) all require OAuth 2.1 + PKCE + DCR per the MCP spec. Public exposure is blocked until the server implements that flow. See "Public ingress" below.
- **Image registry:** Harbor at `harbor.services.coderinserepeat.com/library/`
- **Namespace:** `mcp-paprika` (created by `00-namespace.yaml`)

Until OAuth lands in the server, the only access path is `kubectl port-forward`.

## Build & push the image

The cluster runs amd64; the Mac is arm64. Use buildx with an explicit platform:

```sh
TAG=0.6.0
HARBOR=harbor.services.coderinserepeat.com/library/mcp-paprika
docker buildx build --platform linux/amd64 \
  -t "${HARBOR}:${TAG}" \
  --push .
```

You'll need `docker login harbor.services.coderinserepeat.com` first.
Update the `image:` tag in `k8s/30-deployment.yaml` to match.

## Create the secret

The secret is NOT in `kustomization.yaml` so it never gets committed:

```sh
kubectl apply -f k8s/00-namespace.yaml

# Imperative (recommended — no secret YAML on disk):
kubectl -n mcp-paprika create secret generic mcp-paprika \
  --from-literal=PAPRIKA_EMAIL='you@example.com' \
  --from-literal=PAPRIKA_PASSWORD='...'

# Or copy the template (k8s/secret.yaml is gitignored):
cp k8s/20-secret.example.yaml k8s/secret.yaml
$EDITOR k8s/secret.yaml
kubectl apply -f k8s/secret.yaml
```

## Deploy

```sh
kubectl apply -k k8s/
kubectl -n mcp-paprika rollout status deploy/mcp-paprika
```

First start does a full Paprika sync and builds the vector index — the
`startupProbe` allows up to ~5 minutes for that.

## Reach the server (today, no public ingress)

```sh
kubectl -n mcp-paprika port-forward svc/mcp-paprika 3000:80
curl http://localhost:3000/healthz
```

## Public ingress (future work)

Claude Mobile and Anthropic's MCP relay can only authenticate via the MCP
spec's OAuth 2.1 + PKCE + Dynamic Client Registration flow — they do not
support custom Authorization headers, basic auth, or Cloudflare Access
service tokens. That means the server must implement OAuth itself, exposing
`/.well-known/oauth-authorization-server` and returning 401 on unauthenticated
requests. The `@modelcontextprotocol/sdk/server/auth/*` module provides the
scaffolding.

Two paths once that lands:

1. **Cloudflare Access for SaaS as the OIDC provider** — Access enforces the
   "only my Google identity" policy; the server validates JWTs signed by
   Cloudflare. The server still implements the OAuth metadata endpoint and
   token validation.
2. **Google OAuth directly in the server** — no Cloudflare dependency;
   server checks the Google account against an allowlist.

Either way, the public hostname can ride the existing Tailscale Funnel
pattern (`mcp-paprika.gaur-kardashev.ts.net`) or a Traefik public ingress.
See `50-ingress.yaml` for both shapes.

## Iterate

```sh
docker buildx build --platform linux/amd64 \
  -t "${HARBOR}:${TAG}" --push .
kubectl -n mcp-paprika set image deploy/mcp-paprika mcp-paprika="${HARBOR}:${TAG}"
kubectl -n mcp-paprika rollout status deploy/mcp-paprika
```

## Teardown

```sh
kubectl delete -k k8s/
kubectl -n mcp-paprika delete pvc mcp-paprika-data   # longhorn reclaim is Delete
kubectl delete ns mcp-paprika
```
