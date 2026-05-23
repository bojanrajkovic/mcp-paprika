# Kubernetes manifests

Deploys mcp-paprika using the Streamable HTTP transport with OAuth 2.1 + PKCE
and Dynamic Client Registration. Images are published to GHCR at
`ghcr.io/bojanrajkovic/mcp-paprika`.

- **Namespace:** `mcp-paprika` (created by `00-namespace.yaml`)
- **Storage:** PVC — pick a storage class for your cluster (see Customization)
- **Ingress:** not included — see below

## Customization

Replace all `<placeholder>` values before applying:

| Placeholder         | File                                           | Description                                                                                                                                  |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `<tag>`             | `30-deployment.yaml`                           | Image tag — pick a release from [ghcr.io/bojanrajkovic/mcp-paprika](https://github.com/bojanrajkovic/mcp-paprika/pkgs/container/mcp-paprika) |
| `<your-public-url>` | `30-deployment.yaml`, `20-secret.example.yaml` | Publicly reachable URL for this deployment (e.g. `https://paprika.example.com`) — no trailing slash                                          |
| `<storage-class>`   | `10-pvc.yaml`                                  | Storage class name for the data PVC (e.g. `standard`, `local-path` on k3s)                                                                   |

`MCP_OIDC_PRESET` defaults to `google`; change it in `30-deployment.yaml` for
other IdPs, or replace it with `MCP_OIDC_DISCOVERY_URL`. See
[docs/configuration.md](../docs/configuration.md) for the full OAuth reference.

**No storage class?** Replace the `persistentVolumeClaim` volume block in
`30-deployment.yaml` with `emptyDir: {}`. The disk cache rebuilds on startup
(~2–5 min); OAuth DCR state is lost on pod delete.

## Ingress

`kustomization.yaml` does not include an ingress resource — the right shape
depends entirely on your ingress controller. `50-ingress.example.tailscale-funnel.yaml`
shows a working Tailscale Funnel configuration; copy and adapt it, or write your
own pointing at the `mcp-paprika` Service on port 80.

## Register the Google OAuth client (one-time)

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** of type **Web application**.
3. Under **Authorized redirect URIs**, add exactly:
   ```
   https://<your-public-url>/oauth/callback
   ```
4. Save the `client_id` and `client_secret` — they go into the K8s Secret next.

## Create the secret

The secret is NOT in `kustomization.yaml` so real credentials never get committed:

```sh
kubectl apply -f k8s/00-namespace.yaml

# Imperative (recommended — no secret YAML on disk):
kubectl -n mcp-paprika create secret generic mcp-paprika \
  --from-literal=PAPRIKA_EMAIL='you@example.com' \
  --from-literal=PAPRIKA_PASSWORD='...' \
  --from-literal=MCP_OIDC_CLIENT_ID='...apps.googleusercontent.com' \
  --from-literal=MCP_OIDC_CLIENT_SECRET='GOCSPX-...' \
  --from-literal=MCP_ALLOWED_EMAILS='you@example.com'

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

First start does a full Paprika sync and builds the disk cache — the
`startupProbe` allows up to ~5 minutes for that.

## Verify

```sh
# Health check
curl -sf https://<your-public-url>/healthz | jq

# OAuth metadata — issuer must match MCP_PUBLIC_URL exactly.
curl -sf https://<your-public-url>/.well-known/oauth-authorization-server | jq .issuer
```

Add as a Claude connector: claude.ai → Settings → Connectors → Add custom
connector → `https://<your-public-url>/mcp`. Claude redirects to Google for
sign-in; once you're back, the connector is authorized.

## Update the image

```sh
kubectl -n mcp-paprika set image deploy/mcp-paprika \
  mcp-paprika=ghcr.io/bojanrajkovic/mcp-paprika:<new-tag>
kubectl -n mcp-paprika rollout status deploy/mcp-paprika
```

## Teardown

```sh
kubectl delete -k k8s/
kubectl -n mcp-paprika delete pvc mcp-paprika-data
kubectl delete ns mcp-paprika
```
