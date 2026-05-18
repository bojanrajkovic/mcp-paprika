# MCP SDK Verified API Reference

> Verified against `@modelcontextprotocol/sdk` v1.29.0 — see `scripts/verify-sdk.ts` for compile-time and runtime proof.
>
> This document is the authoritative reference for downstream units (P2-U10, P2-U11, P2-U12).
> Where it differs from the Phase 2 architecture doc, **this document takes precedence**.

## 1. SDK Version

- **Package:** `@modelcontextprotocol/sdk`
- **Installed version:** 1.29.0
- **Installed as:** runtime dependency (`dependencies`, not `devDependencies`)

## 2. Import Paths

**These import paths are verified by `scripts/verify-sdk.ts` as the successful compilation paths for SDK v1.29.0.**

The design research assumed barrel exports at `@modelcontextprotocol/sdk/server`, but the actual SDK uses subpath exports. Use these paths:

```typescript
// Core server and transport classes
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
```

| Construct              | Import Path (verified by scripts/verify-sdk.ts) |
| ---------------------- | ----------------------------------------------- |
| `McpServer`            | `@modelcontextprotocol/sdk/server/mcp.js`       |
| `StdioServerTransport` | `@modelcontextprotocol/sdk/server/stdio.js`     |
| `ResourceTemplate`     | `@modelcontextprotocol/sdk/server/mcp.js`       |
| `CallToolResult`       | `@modelcontextprotocol/sdk/types.js`            |

> **Peer dependency:** The SDK requires `zod ^3.25`. The project's `zod@^3` (resolves to 3.25.76+) satisfies this constraint.

## 3. McpServer

### Constructor

```typescript
const server = new McpServer(
  { name: "mcp-paprika", version: "1.0.0" },  // Implementation: { name: string; version: string }
  options?                                      // ServerOptions (optional)
);
```

### Key Methods

| Method                    | Signature                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `registerTool`            | `(name: string, config: { description?: string; inputSchema?: ZodRawShape }, callback) => RegisteredTool`       |
| `registerResource`        | `(name: string, uri: string \| ResourceTemplate, config: ResourceMetadata, readCallback) => RegisteredResource` |
| `sendResourceListChanged` | `() => void`                                                                                                    |
| `sendToolListChanged`     | `() => void`                                                                                                    |
| `sendPromptListChanged`   | `() => void`                                                                                                    |
| `connect`                 | `(transport: Transport) => Promise<void>`                                                                       |
| `close`                   | `() => Promise<void>`                                                                                           |

## 4. StdioServerTransport

### Constructor

```typescript
const transport = new StdioServerTransport();
// Optional: new StdioServerTransport(customStdin, customStdout)
// Defaults to process.stdin and process.stdout
```

### Usage Pattern

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

## 5. ResourceTemplate

### Constructor

```typescript
const template = new ResourceTemplate(
  "recipe:///{uid}", // URI template string
  {
    list: async (extra) => {
      // ListResourcesCallback | undefined
      return { resources: [] };
    },
    complete: {
      // Optional: completion callbacks per variable
      uid: async (value) => [],
    },
  },
);
```

### Read Callback Signature

When registering a resource with a ResourceTemplate, the read callback receives:

```typescript
server.registerResource(
  "recipe",
  template,
  { description: "A recipe" },
  async (uri: URL, variables: Record<string, string>, extra) => {
    // uri: the resolved URI as a URL object
    // variables: extracted template variables, e.g. { uid: "abc-123" }
    // extra: RequestHandlerExtra with session info
    return { contents: [{ uri: uri.href, text: "..." }] };
  },
);
```

## 6. Tool Registration

```typescript
import { z } from "zod";

server.registerTool(
  "search-recipes",
  {
    description: "Search recipes by query",
    inputSchema: {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results"),
    },
  },
  async (args, extra) => {
    // args is typed as { query: string; limit?: number }
    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
    };
  },
);
```

**Note:** Both `registerTool()` (preferred) and `tool()` (deprecated) exist. Always use `registerTool()`.

## 7. Notifications

The SDK provides **explicit notification methods** on `McpServer`:

```typescript
// Notify clients that the resource list has changed
server.sendResourceListChanged();

// Notify clients that the tool list has changed
server.sendToolListChanged();

// Notify clients that the prompt list has changed
server.sendPromptListChanged();
```

These methods automatically check `isConnected()` before sending. No manual notification construction is needed.

## 8. CallToolResult

```typescript
type CallToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; text?: string; blob?: string } }
  >;
  structuredContent?: Record<string, unknown>; // For tools with outputSchema
  isError?: boolean; // Defaults to false
};
```

### Usage in Tool Handlers

```typescript
// Use the import path confirmed by Phase 1 verification
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

async function handleTool(args: ToolArgs): Promise<CallToolResult> {
  return {
    content: [{ type: "text", text: "Result here" }],
  };
}
```

## 9. Discrepancies from Architecture Doc

| #   | Area              | Architecture Doc Assumed                                                  | Actual SDK API (from Phase 1 verification)                                                                      | Corrected Usage                                                                          |
| --- | ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Import: McpServer | `import { McpServer } from "@modelcontextprotocol/sdk/server"`            | `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"` (subpath export, not barrel)              | `import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";` |
| 2   | Import: Transport | `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server"` | `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"` (subpath export, not barrel) | `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";`      |
| 3   | Notifications     | `server.notification({ method: "notifications/resources/list_changed" })` | Explicit method on McpServer: `sendResourceListChanged()`                                                       | `server.sendResourceListChanged();`                                                      |
| 4   | Resource callback | `(uri, { uid })`                                                          | `(uri: URL, variables: Record<string, string>, extra)`                                                          | `async (uri, variables, extra) => { const uid = variables.uid; ... }`                    |

## 10. Streamable HTTP transport

The Streamable HTTP transport (issue #44) lets HTTP-based MCP clients connect over a
single endpoint that multiplexes JSON-RPC and SSE streaming. Two implementations are
available:

- **Primary**: `@hono/mcp`'s `StreamableHTTPTransport` — a Hono-native wrapper that
  takes a Hono `Context` directly. This is what `src/transport/http.ts` uses.
- **Fallback**: the SDK-native `WebStandardStreamableHTTPServerTransport` — same
  protocol, ships with the SDK; useful if you ever need to drop the `@hono/mcp`
  dependency.

### Verified imports

| Construct                                  | Import Path                                                     |
| ------------------------------------------ | --------------------------------------------------------------- |
| `StreamableHTTPTransport`                  | `@hono/mcp`                                                     |
| `StreamableHTTPServerTransport`            | `@modelcontextprotocol/sdk/server/streamableHttp.js`            |
| `WebStandardStreamableHTTPServerTransport` | `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` |
| `isInitializeRequest`                      | `@modelcontextprotocol/sdk/types.js`                            |

### Constructor options

`StreamableHTTPTransport` accepts the SDK's `StreamableHTTPServerTransportOptions`
(an alias of `WebStandardStreamableHTTPServerTransportOptions`):

```typescript
new StreamableHTTPTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
  onsessioninitialized: (sessionId: string) => void | Promise<void>,
  onsessionclosed: (sessionId: string) => void | Promise<void>,
  enableJsonResponse: false,  // default; true to skip SSE and return JSON
});
```

### handleRequest signature

```typescript
handleRequest(c: Context, parsedBody?: unknown): Promise<Response | undefined>;
```

It takes a Hono `Context`, **not** a `Request` or `c.req.raw`. Pre-parse the JSON body
only when sniffing for `isInitializeRequest` on a new (no-session-id) request — the
transport reads the body itself otherwise.

### Per-session pattern

For stateful mode (one McpServer per HTTP session), wire `onsessioninitialized` to add
to a `Map<sessionId, { server, transport }>` and `onsessionclosed` to remove. Shared
state (Paprika client, caches, stores, vector index) lives in a single `AppContext`;
tool registration happens per-session via `buildMcpServer(app)`. See
`src/transport/http.ts` for the canonical wiring.

### Graceful shutdown

Order is load-bearing: stop sync → `transport.close()` on every session concurrently
(aborts open SSE writers) → clear session map → `httpServer.close()` (drains remaining
short-lived connections). Wrap the whole sequence in a hard timeout (~10s);
`http.Server.close()` waits forever for long-lived SSE GET streams to terminate on
their own.

---

## 5. @hono/mcp@0.2.5 OAuth Surface

**Verified against:** `@hono/mcp@0.2.5` (installed)

This section documents the OAuth 2.1 server provider integration surface from `@hono/mcp` and the MCP SDK. Phase 6 uses these exports to wire the OAuth endpoint surface (authorization, token, revocation, DCR) and customize RFC 8414 metadata.

### Verified imports

| Construct                     | Import Path                                         |
| ----------------------------- | --------------------------------------------------- |
| `mcpAuthRouter`               | `@hono/mcp`                                         |
| `bearerAuth`                  | `@hono/mcp`                                         |
| `authorizeHandler`            | `@hono/mcp/auth`                                    |
| `tokenHandler`                | `@hono/mcp/auth`                                    |
| `revokeHandler`               | `@hono/mcp/auth`                                    |
| `clientRegistrationHandler`   | `@hono/mcp/auth`                                    |
| `wellKnownRouter`             | `@hono/mcp/auth`                                    |
| `createOAuthMetadata`         | `@hono/mcp/auth`                                    |
| `OAuthServerProvider`         | `@modelcontextprotocol/sdk/server/auth/provider.js` |
| `OAuthError` (and subclasses) | `@modelcontextprotocol/sdk/server/auth/errors.js`   |
| `AuthInfo`                    | `@modelcontextprotocol/sdk/server/auth/types.js`    |

### mcpAuthRouter

`mcpAuthRouter(options)` mounts the RFC 6749 / RFC 7591 / RFC 7592 OAuth endpoints. It returns a Hono router.

**Signature:**

```typescript
interface AuthRouterOptions {
  provider: OAuthServerProvider;
  issuerUrl: URL | string;  // String preferred; URL adds trailing slash
  baseUrl?: URL;
  serviceDocumentationUrl?: URL;
  scopesSupported?: string[];
  resourceName?: string;
  resourceServerUrl?: URL;
  authorizationOptions?: { rateLimit?: Partial<ConfigType> | false };
  clientRegistrationOptions?: { rateLimit?: Partial<ConfigType> | false; clientIdGeneration?: boolean; clientSecretExpirySeconds?: number };
  revocationOptions?: { rateLimit?: Partial<ConfigType> | false };
  tokenOptions?: { rateLimit?: Partial<ConfigType> | false };
}

mcpAuthRouter(options: AuthRouterOptions): Hono;
```

**Routes mounted:**

- `GET /authorize` — calls `provider.authorize(...)`
- `POST /token` — calls `provider.exchangeAuthorizationCode` or `provider.exchangeRefreshToken`
- `POST /register` — calls `provider.clientsStore.registerClient(...)` (if provider has `clientsStore`)
- `POST /revoke` — calls `provider.revokeToken(...)` (if provider has `revokeToken`)
- `GET /.well-known/oauth-authorization-server` — serves RFC 8414 metadata
- `GET /.well-known/oauth-protected-resource/{rsPath}` — serves RFC 9728 resource metadata

**Load-bearing behavior:**

- PKCE validation (code_challenge + code_challenge_method=S256) is enforced by the library BEFORE calling `provider.authorize`.
- The library catches thrown errors: if `error instanceof OAuthError`, calls `error.toResponseObject()` for the HTTP response. Otherwise, wraps as 500 `ServerError`.
- `issuerUrl` as a URL object calls `.href`, which adds a trailing slash — breaks AC2.1's exact-match invariant. **Always pass strings.**
- RFC 9207 `iss` is NOT auto-injected into authorization response redirects. Only error/success state is included; custom routes must add `iss` manually.

### createOAuthMetadata

`createOAuthMetadata(options)` builds the RFC 8414 authorization server metadata object, suitable for mutation.

**Signature:**

```typescript
interface CreateOAuthMetadataOptions {
  issuerUrl: URL | string;
  baseUrl?: URL;
  serviceDocumentationUrl?: URL;
  scopesSupported?: string[];
  provider?: OAuthServerProvider;
}

createOAuthMetadata(options: CreateOAuthMetadataOptions): OAuthMetadata;
```

**Default output (before customization):**

```typescript
{
  issuer: "https://issuer.example.com",  // verbatim from issuerUrl if string; url.href if URL
  service_documentation: options.serviceDocumentationUrl?.href,
  authorization_endpoint: "https://issuer.example.com/authorize",
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint: "https://issuer.example.com/token",
  token_endpoint_auth_methods_supported: ["client_secret_post"],  // HARD-CODED; must override
  grant_types_supported: ["authorization_code", "refresh_token"],
  scopes_supported: options.scopesSupported,
  revocation_endpoint: "https://issuer.example.com/revoke",  // if provider?.revokeToken
  revocation_endpoint_auth_methods_supported: ["client_secret_post"],  // if revocation_endpoint
  registration_endpoint: "https://issuer.example.com/register",  // if provider?.clientsStore.registerClient
}
```

**Known issues:**

- `token_endpoint_auth_methods_supported` is hard-coded to `["client_secret_post"]`. Must override to `["none"]` for public clients (Phase 6 Task 4).
- `authorization_response_iss_parameter_supported` is absent by default. Must be set to `true` for RFC 9207 compliance (Phase 6 Task 4).
- `id_token_signing_alg_values_supported` is NOT included by default; no action needed for opaque-token setups.

### wellKnownRouter

`wellKnownRouter(options)` mounts the RFC 8414 / RFC 9728 well-known endpoints with the provided metadata.

**Signature:**

```typescript
interface WellKnownRouterOptions {
  oauthMetadata: OAuthMetadata;
  resourceServerUrl: URL;
  // additional fields may be present in v0.2.5
}

wellKnownRouter(options: WellKnownRouterOptions): Hono;
```

**Routes mounted:**

- `GET /.well-known/oauth-authorization-server` — returns the provided `oauthMetadata` as JSON
- `GET /.well-known/oauth-protected-resource` — returns RFC 9728 resource metadata with `resource` = `resourceServerUrl` and `authorization_servers` array

**Mount order:** Must be mounted BEFORE `mcpAuthRouter` in Hono's router chain. Hono's first-match-wins routing ensures this custom instance serves instead of the library's built-in.

### bearerAuth

`bearerAuth(options)` is a Hono middleware that validates Bearer token authorization.

**Signature (from Hono core):**

```typescript
interface BearerAuthOptions {
  verifyToken: (token: string, c: Context) => boolean | Promise<boolean>;
  realm?: string;
  prefix?: string;
}

bearerAuth(options: BearerAuthOptions): MiddlewareHandler;
```

**Load-bearing behavior:**

- This IS Hono core's `bearerAuth`, imported from `"hono/bearer-auth"`.
- On auth failure (401), the default `WWW-Authenticate` header is `Bearer error="Unauthorized"` (literal string).
- @hono/mcp wraps this with a custom middleware that injects RFC 9110-compliant `WWW-Authenticate` headers with additional metadata:
  ```
  WWW-Authenticate: Bearer error="invalid_token", error_description="...", resource_metadata="https://issuer/.well-known/oauth-protected-resource"
  ```
- The `resource_metadata` field points to the RFC 9728 resource metadata endpoint for the issuer.

### OAuthServerProvider interface

The `OAuthServerProvider` interface defines all methods Phase 6's `MintingOAuthServerProvider` must implement.

**Signature (from SDK):**

```typescript
interface OAuthServerProvider {
  get clientsStore(): OAuthRegisteredClientsStore; // REQUIRED; presence gates registration_endpoint

  authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response, // express Response
  ): Promise<void>;

  challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string>; // REQUIRED; enables PKCE

  exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens>;

  exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens>;

  verifyAccessToken(token: string): Promise<AuthInfo>;

  revokeToken?(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void>; // optional; absence gates revocation_endpoint

  skipLocalPkceValidation?: boolean; // optional; skips local PKCE validation if upstream does it
}
```

**Error handling:** All methods that can fail MUST throw SDK `OAuthError` subclasses (`InvalidGrantError`, `InvalidScopeError`, `InvalidTokenError`, `InvalidTargetError`, `InvalidRequestError`, etc.). The library catches these and serializes to proper RFC 6749 error responses.

### OAuthError subclasses

Standard error types (from `@modelcontextprotocol/sdk/server/auth/errors.js`):

| Class                 | Error code        | Use case                                         |
| --------------------- | ----------------- | ------------------------------------------------ |
| `InvalidGrantError`   | `invalid_grant`   | Token invalid/expired, auth code invalid/expired |
| `InvalidScopeError`   | `invalid_scope`   | Requested scope exceeds granted scope            |
| `InvalidTokenError`   | `invalid_token`   | Token invalid or expired (for revocation)        |
| `InvalidTargetError`  | `invalid_target`  | Resource mismatch (RFC 8707)                     |
| `InvalidRequestError` | `invalid_request` | Generic request validation failure               |

**Converting Result to throw:**

```typescript
// Phase 5 TokenStore.rotateRefresh returns Result<IssuedPair, OAuthError>
const result = await tokenStore.rotateRefresh(...);
return result.match(
  (pair) => ({ access_token: pair.access.plaintext, ... }),
  (err) => { throw err; }  // OAuthError from Phase 1's factory, ready to throw
);
```

### AuthInfo type

Type returned by `provider.verifyAccessToken(token)`.

**Shape (from SDK):**

```typescript
interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number; // Unix timestamp in seconds
  resource?: URL; // optional; resource binding
  extra?: Record<string, unknown>; // custom fields (identity info, etc.)
}
```

The `bearerAuth` middleware (from `@hono/mcp`) calls `verifyAccessToken` to populate this on the request context.
