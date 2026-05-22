/**
 * buildAuthContext — constructs the OAuth 2.1 runtime for HTTP mode.
 *
 * Returns null when transport !== "http" (stdio mode needs no auth).
 * Throws on misconfiguration or upstream discovery failure — this is a
 * fail-fast startup operation; there is no value running HTTP mode if
 * the OAuth stack can't authenticate anyone.
 *
 * Called once per process from buildAppContext (src/server/build.ts)
 * after cache.init() completes.
 */

// pattern: Imperative Shell

import type { Logger } from "pino";
import type { DiskCache } from "../cache/disk-cache.js";
import type { PaprikaConfig } from "../utils/config.js";
import { resolvePreset } from "./presets.js";
import { loadDiscovery, createJwksFor } from "./oidc-client.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { MintingOAuthServerProvider } from "./provider.js";
import { AuthCleanup } from "./cleanup.js";
import { MAX_REGISTERED_CLIENTS } from "./routes.js";
import type { AuthContext, ResolvedOAuthConfig } from "./types.js";

export async function buildAuthContext(
  config: PaprikaConfig,
  cache: DiskCache,
  parentLog: Logger,
): Promise<AuthContext | null> {
  if (config.transport !== "http") return null;

  if (config.oauth === undefined) {
    // The root-level superRefine in src/utils/config.ts catches this case before
    // we get here, but defensively re-check so downstream code can rely on non-null.
    throw new Error("OAuth config required for HTTP transport (should have failed at config load)");
  }

  // resolvePreset accepts only provider-level fields (discoveryUrl, scopes,
  // emailVerifiedPolicy, allowedAlgs) — NOT deployment fields (publicUrl,
  // clientId, clientSecret, allowlist). Those are merged separately below.
  //
  // exactOptionalPropertyTypes: true requires we omit undefined fields entirely
  // rather than explicitly passing them as undefined.
  type PresetOverrides = Parameters<typeof resolvePreset>[1];
  const presetOverrides: PresetOverrides = {};
  if (config.oauth.discoveryUrl !== undefined) presetOverrides.discoveryUrl = config.oauth.discoveryUrl;
  if (config.oauth.scopes !== undefined) presetOverrides.scopes = config.oauth.scopes;
  if (config.oauth.emailVerifiedPolicy !== undefined)
    presetOverrides.emailVerifiedPolicy = config.oauth.emailVerifiedPolicy;
  if (config.oauth.allowedAlgs !== undefined) presetOverrides.allowedAlgs = config.oauth.allowedAlgs;

  const resolveResult = resolvePreset(config.oauth.preset, presetOverrides);

  const presetResult = resolveResult.match(
    (r) => r,
    (e) => {
      throw e; // fail-fast at startup
    },
  );

  // Assemble full ResolvedOAuthConfig by merging the preset result with
  // the deployment-specific fields validated by superRefine.
  // These three fields are guaranteed non-undefined when transport === "http"
  // by superRefine in src/utils/config.ts.  The invariant guards below make
  // that contract explicit and narrow the types without `as string` casts.
  if (config.oauth.publicUrl === undefined) {
    throw new Error("invariant: oauth.publicUrl must be set when transport=http");
  }
  if (config.oauth.clientId === undefined) {
    throw new Error("invariant: oauth.clientId must be set when transport=http");
  }
  if (config.oauth.clientSecret === undefined) {
    throw new Error("invariant: oauth.clientSecret must be set when transport=http");
  }

  const resolved: ResolvedOAuthConfig = {
    ...presetResult,
    publicUrl: config.oauth.publicUrl,
    clientId: config.oauth.clientId,
    clientSecret: config.oauth.clientSecret,
    trustProxy: config.oauth.trustProxy,
    allowlist: config.oauth.allowlist,
  };

  // Fetch + validate upstream discovery document (rejects http:// endpoints; checks alg overlap)
  const discovery = await loadDiscovery(
    resolved.discoveryUrl,
    resolved.allowedAlgs,
    parentLog.child({ component: "oidc-client" }),
  );
  const jwks = createJwksFor(discovery);

  const clientStore = new DiskClientRegistrationStore(cache, resolved.publicUrl, MAX_REGISTERED_CLIENTS);
  const tokenStore = new TokenStore(cache);
  const requestStore = new AuthRequestStore();
  const codeStore = new AuthCodeStore();

  const provider = new MintingOAuthServerProvider(
    clientStore,
    tokenStore,
    requestStore,
    codeStore,
    discovery,
    resolved,
    resolved.publicUrl,
  );

  const cleanup = new AuthCleanup(clientStore, tokenStore, cache, requestStore, codeStore);

  return {
    provider,
    config: resolved,
    discovery,
    jwks,
    authRequests: requestStore,
    authCodes: codeStore,
    tokenStore,
    clientStore,
    cleanup,
    log: {
      auth: parentLog.child({ component: "auth" }),
      oidcClient: parentLog.child({ component: "oidc-client" }),
    },
  };
}
