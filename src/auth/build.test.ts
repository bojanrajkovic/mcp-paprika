/**
 * Tests for buildAuthContext factory.
 *
 * Tests:
 * - Returns null for stdio transport
 * - Throws for http transport with no oauth config (defensive guard)
 * - Happy path: builds full AuthContext with MSW OIDC stub
 * - Throws when discovery returns 500
 */

import { fromAny } from "@total-typescript/shoehorn";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PaprikaConfig } from "../utils/config.js";

import { createOidcStub } from "../../test/auth/__fixtures__/oidc-stub.js";
import { useMswServer } from "../../test/support/msw.js";
import { useXdgIsolation } from "../../test/support/xdg-isolation.js";
import { SILENT_LOG } from "../utils/log.js";
import { buildAuthContext } from "./build.js";
import { buildAuthCaches } from "./disk.js";

const msw = useMswServer([], { onUnhandledRequest: "bypass" });
const xdg = useXdgIsolation("mcp-paprika-build-auth");

beforeEach(async () => {
  await xdg.setup();
});

afterEach(async () => {
  await xdg.teardown();
});

function makeStdioConfig(): PaprikaConfig {
  return fromAny({
    paprika: { email: "test@example.com", password: "secret" },
    sync: { enabled: false, interval: 60_000 },
    transport: "stdio",
    http: { port: 3000, host: "127.0.0.1", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
  });
}

function makeHttpConfig(oauthIssuer: string, redirectAllowlist: ReadonlyArray<string> = []): PaprikaConfig {
  return fromAny({
    paprika: { email: "test@example.com", password: "secret" },
    sync: { enabled: false, interval: 60_000 },
    transport: "http",
    http: { port: 0, host: "127.0.0.1", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
    oauth: {
      publicUrl: "https://mcp.example.test",
      preset: undefined,
      discoveryUrl: `${oauthIssuer}/.well-known/openid-configuration`,
      scopes: ["openid", "email"],
      emailVerifiedPolicy: "strict",
      allowedAlgs: ["RS256"],
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      allowlist: { emails: ["user@example.com"], subs: [] },
      redirectAllowlist,
    },
  });
}

describe("buildAuthContext", () => {
  describe("BA.1: returns null for stdio transport", () => {
    it("returns null when config.transport is 'stdio'", async () => {
      // if config.transport !== "http" return null
      const cache = await buildAuthCaches(xdg.dir());

      const config = makeStdioConfig();
      const result = await buildAuthContext(config, cache, SILENT_LOG);

      expect(result).toBeNull();
    });
  });

  describe("BA.2: throws for http + no oauth config (defensive guard)", () => {
    it("throws Error when transport is http but oauth config is undefined", async () => {
      // defensive guard for http without oauth block
      const cache = await buildAuthCaches(xdg.dir());

      const config: PaprikaConfig = fromAny({
        paprika: { email: "test@example.com", password: "secret" },
        sync: { enabled: false, interval: 60_000 },
        transport: "http",
        http: { port: 0, host: "127.0.0.1", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
        // no oauth block
      });

      await expect(buildAuthContext(config, cache, SILENT_LOG)).rejects.toThrow(
        "OAuth config required for HTTP transport",
      );
    });
  });

  describe("BA.3: happy path — builds full AuthContext with OIDC stub", () => {
    it("returns a fully-populated AuthContext with all required fields", async () => {
      // builds stores, provider, cleanup, and returns AuthContext
      const oidcStub = createOidcStub({
        issuer: "https://accounts.example.test",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        defaultIdentity: { email: "user@example.com", sub: "user-sub-1", emailVerified: true },
      });
      msw.use(...oidcStub.handlers);

      const cache = await buildAuthCaches(xdg.dir());

      const config = makeHttpConfig("https://accounts.example.test");
      const result = await buildAuthContext(config, cache, SILENT_LOG);

      expect(result).not.toBeNull();
      // All required AuthContext fields must be present
      expect(result!.provider).toBeDefined();
      expect(result!.config).toBeDefined();
      expect(result!.config.publicUrl).toBe("https://mcp.example.test");
      expect(result!.config.clientId).toBe("test-client-id");
      expect(result!.discovery).toBeDefined();
      expect(result!.discovery.issuer).toBe("https://accounts.example.test");
      expect(result!.jwks).toBeDefined();
      expect(result!.authRequests).toBeDefined();
      expect(result!.authCodes).toBeDefined();
      expect(result!.pendingAuthorizations).toBeDefined();
      expect(result!.tokenStore).toBeDefined();
      expect(result!.clientStore).toBeDefined();
      expect(result!.cleanup).toBeDefined();
    });

    it("normalizes raw redirect-allowlist entries to canonical origins (#147)", async () => {
      const oidcStub = createOidcStub({
        issuer: "https://accounts.example.test",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        defaultIdentity: { email: "user@example.com", sub: "user-sub-1", emailVerified: true },
      });
      msw.use(...oidcStub.handlers);

      const cache = await buildAuthCaches(xdg.dir());

      // Path + default port should collapse to the bare origin.
      const config = makeHttpConfig("https://accounts.example.test", [
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.com:443",
      ]);
      const result = await buildAuthContext(config, cache, SILENT_LOG);

      expect(result!.config.redirectAllowlist).toEqual(["https://claude.ai", "https://claude.com"]);
    });

    it("fails fast when a redirect-allowlist entry is malformed (#147)", async () => {
      const oidcStub = createOidcStub({
        issuer: "https://accounts.example.test",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        defaultIdentity: { email: "user@example.com", sub: "user-sub-1", emailVerified: true },
      });
      msw.use(...oidcStub.handlers);

      const cache = await buildAuthCaches(xdg.dir());

      // http for a non-loopback host is not a permitted redirect origin.
      const config = makeHttpConfig("https://accounts.example.test", ["http://evil.example.com"]);

      await expect(buildAuthContext(config, cache, SILENT_LOG)).rejects.toThrow(/redirect-allowlist origin/);
    });
  });

  describe("BA.4: throws when discovery returns 500", () => {
    it("rejects when the OIDC discovery endpoint returns a non-2xx status", async () => {
      // fail-fast startup operation — loadDiscovery throws on non-ok
      msw.use(
        http.get("https://accounts.example.test/.well-known/openid-configuration", () =>
          HttpResponse.json({ error: "server_error" }, { status: 500 }),
        ),
      );

      const cache = await buildAuthCaches(xdg.dir());

      const config = makeHttpConfig("https://accounts.example.test");
      await expect(buildAuthContext(config, cache, SILENT_LOG)).rejects.toThrow();
    });
  });
});
