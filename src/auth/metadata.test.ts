import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTempDir } from "../../test/support/disk-caches.js";
import { BRANDING, FAVICON_PATH } from "../utils/branding.js";
import { SILENT_LOG } from "../utils/log.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { type AuthCache, buildAuthCaches } from "./disk.js";
import { buildAuthMetadataRouter, buildCustomizedAuthorizationServerMetadata } from "./metadata.js";
import { PendingAuthorizationStore } from "./pending-authorization-store.js";
import { MintingOAuthServerProvider } from "./provider.js";
import { TokenStore } from "./token-store.js";

describe("OAuth Metadata Customization", () => {
  const tmp = useTempDir("paprika-metadata-");
  let cache: AuthCache;
  let provider: MintingOAuthServerProvider;

  beforeEach(async () => {
    await tmp.setup();
    cache = (await buildAuthCaches(tmp.dir()))._unsafeUnwrap();

    const clientStore = new DiskClientRegistrationStore(cache, "https://mcp.example.com", SILENT_LOG);
    const tokenStore = new TokenStore(cache);
    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();

    provider = new MintingOAuthServerProvider(
      clientStore,
      tokenStore,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      {
        issuer: "https://idp.stub.example.com",
        authorization_endpoint: "https://idp.stub.example.com/authorize",
        token_endpoint: "https://idp.stub.example.com/token",
        jwks_uri: "https://idp.stub.example.com/jwks",
        id_token_signing_alg_values_supported: ["RS256"],
      },
      {
        discoveryUrl: "https://idp.stub.example.com/.well-known/openid-configuration",
        publicUrl: "https://mcp.example.com",
        presetName: null,
        clientId: "stub-client-id",
        clientSecret: "stub-client-secret",
        scopes: ["openid", "email"],
        emailVerifiedPolicy: "if-present",
        trustProxy: false,
        allowlist: { emails: [], subs: [] },
        allowedAlgs: ["RS256"],
        redirectAllowlist: [],
      },
      "https://mcp.example.com",
      SILENT_LOG,
    );
  });

  afterEach(async () => {
    await tmp.teardown();
  });

  describe("buildCustomizedAuthorizationServerMetadata", () => {
    it("issuer field equals input string verbatim (no trailing slash)", () => {
      const meta = buildCustomizedAuthorizationServerMetadata({
        issuerUrl: "https://m.example.com",
        provider,
      });
      expect(meta.issuer).toBe("https://m.example.com");
    });

    it("token_endpoint_auth_methods_supported is exactly ['none'] (overridden from library default)", () => {
      const meta = buildCustomizedAuthorizationServerMetadata({
        issuerUrl: "https://m.example.com",
        provider,
      });
      expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);
    });

    it("code_challenge_methods_supported is exactly ['S256'] (library default, unchanged)", () => {
      const meta = buildCustomizedAuthorizationServerMetadata({
        issuerUrl: "https://m.example.com",
        provider,
      });
      expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    });

    it("authorization_response_iss_parameter_supported is true (added — not in library default)", () => {
      const meta = buildCustomizedAuthorizationServerMetadata({
        issuerUrl: "https://m.example.com",
        provider,
      });
      expect(meta["authorization_response_iss_parameter_supported"]).toBe(true);
    });

    it("id_token_signing_alg_values_supported field is NOT present", () => {
      const meta = buildCustomizedAuthorizationServerMetadata({
        issuerUrl: "https://m.example.com",
        provider,
      });
      expect(meta).not.toHaveProperty("id_token_signing_alg_values_supported");
    });

    it("no metadata field anywhere has value 'none' except auth_methods (which is intentional public-client config)", () => {
      const meta = buildCustomizedAuthorizationServerMetadata({
        issuerUrl: "https://m.example.com",
        provider,
      });

      // Recursive scan for 'none' values, excluding intentional auth_methods
      const findNone = (obj: unknown, path: string[] = []): Array<string> => {
        const results: Array<string> = [];
        if (typeof obj !== "object" || obj === null) return results;

        for (const [key, value] of Object.entries(obj)) {
          const currentPath = [...path, key];
          const pathStr = currentPath.join(".");
          // Skip if any part of the path contains "auth_methods"
          const isAuthMethod = pathStr.includes("auth_methods");

          if (value === "none" && !isAuthMethod) {
            results.push(pathStr);
          }
          if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
              if (value[i] === "none" && !isAuthMethod) {
                results.push(`${pathStr}[${i}]`);
              }
              if (typeof value[i] === "object") {
                results.push(...findNone(value[i], [...currentPath, `[${i}]`]));
              }
            }
          } else if (typeof value === "object") {
            results.push(...findNone(value, currentPath));
          }
        }
        return results;
      };

      const noneViolations = findNone(meta);
      expect(noneViolations).toEqual([]);
    });

    it("revocation_endpoint_auth_methods_supported removed (public clients need no credentials)", () => {
      const meta = buildCustomizedAuthorizationServerMetadata({
        issuerUrl: "https://m.example.com",
        provider,
      });

      // public-client setup — we delete the field entirely so the flat-value
      // scan in integration tests sees exactly one "none" (token_endpoint_auth_methods_supported).
      expect(meta.revocation_endpoint_auth_methods_supported).toBeUndefined();
    });

    it("adds connector branding: service_documentation + logo_uri at the issuer favicon", () => {
      const meta = buildCustomizedAuthorizationServerMetadata({
        issuerUrl: "https://m.example.com",
        provider,
      });
      expect(meta.service_documentation).toBe(BRANDING.websiteUrl);
      expect(meta["logo_uri"]).toBe(`https://m.example.com${FAVICON_PATH}`);
    });
  });

  describe("buildAuthMetadataRouter (wire-level test)", () => {
    it("GET /.well-known/oauth-authorization-server returns customized metadata", async () => {
      const app = new Hono();
      app.route(
        "/",
        buildAuthMetadataRouter({
          issuerUrl: "https://m.example.com",
          provider,
          resourceServerUrl: new URL("https://m.example.com"),
        }),
      );

      const res = await app.request("/.well-known/oauth-authorization-server");
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body["token_endpoint_auth_methods_supported"]).toEqual(["none"]);
      expect(body["authorization_response_iss_parameter_supported"]).toBe(true);
      expect(body).not.toHaveProperty("id_token_signing_alg_values_supported");
      expect(body["logo_uri"]).toBe(`https://m.example.com${FAVICON_PATH}`);
    });

    it("GET /.well-known/oauth-protected-resource returns resource = issuer; authorization_servers includes issuer", async () => {
      const app = new Hono();
      const resourceUrl = new URL("https://m.example.com");
      app.route(
        "/",
        buildAuthMetadataRouter({
          issuerUrl: "https://m.example.com",
          provider,
          resourceServerUrl: resourceUrl,
        }),
      );

      const res = await app.request("/.well-known/oauth-protected-resource");
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      // resource from URL may have trailing slash; normalize for comparison
      const resource = String(body["resource"]).replace(/\/$/, "");
      expect(resource).toBe("https://m.example.com");
      expect(Array.isArray(body["authorization_servers"])).toBe(true);
      const authServers = (body["authorization_servers"] as Array<string>).map((s) => s.replace(/\/$/, ""));
      expect(authServers).toContain("https://m.example.com");
    });
  });
});
