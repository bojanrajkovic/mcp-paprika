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

import { buildAuthContext } from "./build.js";
import { createOidcStub } from "./__fixtures__/oidc-stub.js";
import type { PaprikaConfig } from "../utils/config.js";
import { DiskCacheRoot } from "../cache/disk/index.js";
import { useXdgIsolation } from "../__fixtures__/xdg-isolation.js";
import { useMswServer } from "../__fixtures__/msw.js";
import { SILENT_LOG } from "../utils/log.js";

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

function makeHttpConfig(oauthIssuer: string): PaprikaConfig {
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
    },
  });
}

describe("buildAuthContext", () => {
  describe("BA.1: returns null for stdio transport", () => {
    it("returns null when config.transport is 'stdio'", async () => {
      // PLAN says (phase_07.md:305-306): if config.transport !== "http" return null
      const cache = new DiskCacheRoot(xdg.dir());
      await cache.init();

      const config = makeStdioConfig();
      const result = await buildAuthContext(config, cache, SILENT_LOG);

      expect(result).toBeNull();
    });
  });

  describe("BA.2: throws for http + no oauth config (defensive guard)", () => {
    it("throws Error when transport is http but oauth config is undefined", async () => {
      // PLAN says (phase_07.md:307-310): defensive guard for http without oauth block
      const cache = new DiskCacheRoot(xdg.dir());
      await cache.init();

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
      // PLAN says (phase_07.md:330-362): builds stores, provider, cleanup, and returns AuthContext
      const oidcStub = createOidcStub({
        issuer: "https://accounts.example.test",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        defaultIdentity: { email: "user@example.com", sub: "user-sub-1", emailVerified: true },
      });
      msw.use(...oidcStub.handlers);

      const cache = new DiskCacheRoot(xdg.dir());
      await cache.init();

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
      expect(result!.tokenStore).toBeDefined();
      expect(result!.clientStore).toBeDefined();
      expect(result!.cleanup).toBeDefined();
    });
  });

  describe("BA.4: throws when discovery returns 500", () => {
    it("rejects when the OIDC discovery endpoint returns a non-2xx status", async () => {
      // PLAN says (phase_07.md:329): fail-fast startup operation — loadDiscovery throws on non-ok
      msw.use(
        http.get("https://accounts.example.test/.well-known/openid-configuration", () =>
          HttpResponse.json({ error: "server_error" }, { status: 500 }),
        ),
      );

      const cache = new DiskCacheRoot(xdg.dir());
      await cache.init();

      const config = makeHttpConfig("https://accounts.example.test");
      await expect(buildAuthContext(config, cache, SILENT_LOG)).rejects.toThrow();
    });
  });
});
