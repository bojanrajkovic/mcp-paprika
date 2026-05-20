# Kubernetes manifests

Deploys mcp-paprika to the k3s homelab (`default` kubectl context).

- **Storage:** `longhorn-ssd` (distributed; PVC survives node moves)
- **Public ingress:** **Tailscale Funnel** at `https://paprika.gaur-kardashev.ts.net` — OAuth 2.1 + PKCE + Dynamic Client Registration is built into the server, with Google as the upstream IdP
- **Image registry:** Harbor at `harbor.services.coderinserepeat.com/library/`
- **Namespace:** `mcp-paprika` (created by `00-namespace.yaml`)

## Build & push the image

The cluster runs amd64; the Mac is arm64. Use buildx with an explicit platform:

```sh
TAG=1.2.0-rc1
HARBOR=harbor.services.coderinserepeat.com/mcp-paprika/mcp-paprika
docker buildx build --platform linux/amd64 \
  -t "${HARBOR}:${TAG}" \
  --push .
```

You'll need `docker login harbor.services.coderinserepeat.com` first.
Update the `image:` tag in `k8s/30-deployment.yaml` to match.

## Register the Google OAuth client (one-time)

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** of type **Web application**.
3. Under **Authorized redirect URIs**, add exactly:
   ```
   https://paprika.gaur-kardashev.ts.net/oauth/callback
   ```
4. Save the `client_id` and `client_secret` — they go into the K8s Secret next.

## Create the secret

The secret is NOT in `kustomization.yaml` so real credentials never get committed:

```sh
kubectl --context=default apply -f k8s/00-namespace.yaml

# Imperative (recommended — no secret YAML on disk):
kubectl --context=default -n mcp-paprika create secret generic mcp-paprika \
  --from-literal=PAPRIKA_EMAIL='you@example.com' \
  --from-literal=PAPRIKA_PASSWORD='...' \
  --from-literal=MCP_OIDC_CLIENT_ID='...apps.googleusercontent.com' \
  --from-literal=MCP_OIDC_CLIENT_SECRET='GOCSPX-...' \
  --from-literal=MCP_ALLOWED_EMAILS='you@example.com'

# Or copy the template (k8s/secret.yaml is gitignored):
cp k8s/20-secret.example.yaml k8s/secret.yaml
$EDITOR k8s/secret.yaml
kubectl --context=default apply -f k8s/secret.yaml
```

## Deploy

```sh
kubectl --context=default apply -k k8s/
kubectl --context=default -n mcp-paprika rollout status deploy/mcp-paprika
```

First start does a full Paprika sync and builds the disk cache — the
`startupProbe` allows up to ~5 minutes for that.

## Verify

```sh
# Healthz over the funnel (may take ~30s after first apply for Tailscale to
# provision the public hostname; check `kubectl -n mcp-paprika get ingress`
# for the status.loadBalancer.ingress hostname).
curl -sf https://paprika.gaur-kardashev.ts.net/healthz | jq

# OAuth metadata — issuer must match MCP_PUBLIC_URL exactly, no trailing slash.
curl -sf https://paprika.gaur-kardashev.ts.net/.well-known/oauth-authorization-server | jq .issuer
```

Add as a Claude connector: claude.ai → Settings → Connectors → Add custom
connector → `https://paprika.gaur-kardashev.ts.net/mcp`. Claude redirects
to Google for sign-in; once you're back, the connector is authorized.

## Iterate

```sh
docker buildx build --platform linux/amd64 \
  -t "${HARBOR}:${TAG}" --push .
kubectl --context=default -n mcp-paprika set image deploy/mcp-paprika mcp-paprika="${HARBOR}:${TAG}"
kubectl --context=default -n mcp-paprika rollout status deploy/mcp-paprika
```

## Teardown

```sh
kubectl --context=default delete -k k8s/
kubectl --context=default -n mcp-paprika delete pvc mcp-paprika-data   # longhorn reclaim is Delete
kubectl --context=default delete ns mcp-paprika
```
