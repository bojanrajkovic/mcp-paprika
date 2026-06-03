/**
 * Tests for OIDC preset table and resolver
 */

import { describe, expect, it } from "vitest";

import type { OIDCPreset, ResolvedOAuthConfig } from "./types.js";

import { OIDC_PRESETS, resolvePreset } from "./presets.js";

describe("OIDC Presets", () => {
  describe("OIDC_PRESETS table", () => {
    it("contains google preset with discoveryUrl", () => {
      const preset = OIDC_PRESETS.google;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBe("https://accounts.google.com/.well-known/openid-configuration");
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("strict");
      expect(preset.allowedAlgs).toEqual(["RS256"]);
    });

    it("contains entra preset without discoveryUrl", () => {
      const preset: OIDCPreset = OIDC_PRESETS.entra;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBeUndefined();
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("strict");
      expect(preset.allowedAlgs).toEqual(["RS256"]);
    });

    it("contains okta preset without discoveryUrl", () => {
      const preset: OIDCPreset = OIDC_PRESETS.okta;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBeUndefined();
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("strict");
      expect(preset.allowedAlgs).toEqual(["RS256"]);
    });

    it("contains auth0 preset without discoveryUrl", () => {
      const preset: OIDCPreset = OIDC_PRESETS.auth0;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBeUndefined();
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("if-present");
      expect(preset.allowedAlgs).toEqual(["RS256"]);
    });

    it("contains keycloak preset without discoveryUrl", () => {
      const preset: OIDCPreset = OIDC_PRESETS.keycloak;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBeUndefined();
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("strict");
      expect(preset.allowedAlgs).toEqual(["RS256", "ES256"]);
    });

    it("is readonly", () => {
      expect(OIDC_PRESETS).toBeDefined();
      // Object.freeze() makes the object immutable
      expect(Object.isFrozen(OIDC_PRESETS)).toBe(true);
    });
  });

  describe("resolvePreset - custom discovery URL path (name === undefined)", () => {
    it("returns err when discoveryUrl is missing", () => {
      const result = resolvePreset(undefined, {
        scopes: ["openid"],
        emailVerifiedPolicy: "strict",
        allowedAlgs: ["RS256"],
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => expect(error.message).toContain("discoveryUrl"),
      );
    });

    it("defaults scopes to ['openid','email','profile'] when not provided", () => {
      // Custom-discovery only requires discoveryUrl. The other three fields
      // are documented as optional in the config schema and the README walks
      // through the "set MCP_OIDC_DISCOVERY_URL directly" path without
      // mentioning them, so missing values fall back to the same defaults
      // every preset uses (openid + email + profile).
      const result = resolvePreset(undefined, {
        discoveryUrl: "https://example.com/.well-known/openid-configuration",
        emailVerifiedPolicy: "strict",
        allowedAlgs: ["RS256"],
      });

      result.match(
        (config) => {
          expect(config.scopes).toEqual(["openid", "email", "profile"]);
        },
        (error) => expect.fail(`Expected Ok but got Err: ${error.message}`),
      );
    });

    it("defaults emailVerifiedPolicy to 'strict' when not provided", () => {
      const result = resolvePreset(undefined, {
        discoveryUrl: "https://example.com/.well-known/openid-configuration",
        scopes: ["openid"],
        allowedAlgs: ["RS256"],
      });

      result.match(
        (config) => {
          expect(config.emailVerifiedPolicy).toBe("strict");
        },
        (error) => expect.fail(`Expected Ok but got Err: ${error.message}`),
      );
    });

    it("defaults allowedAlgs to ['RS256'] when not provided", () => {
      const result = resolvePreset(undefined, {
        discoveryUrl: "https://example.com/.well-known/openid-configuration",
        scopes: ["openid"],
        emailVerifiedPolicy: "strict",
      });

      result.match(
        (config) => {
          expect(config.allowedAlgs).toEqual(["RS256"]);
        },
        (error) => expect.fail(`Expected Ok but got Err: ${error.message}`),
      );
    });

    it("treats empty-array scopes/allowedAlgs as 'not provided' and uses defaults", () => {
      // An operator who sets MCP_OIDC_SCOPES="" (e.g. via dotenv) ends up with
      // listField parsing to []. The resolver's prior `?? defaults` only
      // triggered on undefined/null, so empty arrays silently became the
      // effective scope list and broke /authorize (most IdPs refuse to issue
      // an id_token when scope is empty). Treat [] as "use default" to fail
      // gracefully back to documented defaults instead.
      const result = resolvePreset(undefined, {
        discoveryUrl: "https://example.com/.well-known/openid-configuration",
        scopes: [],
        allowedAlgs: [],
      });
      result.match(
        (config) => {
          expect(config.scopes).toEqual(["openid", "email", "profile"]);
          expect(config.allowedAlgs).toEqual(["RS256"]);
        },
        (error) => expect.fail(`Expected Ok but got Err: ${error.message}`),
      );
    });

    it("accepts discoveryUrl alone — all three other fields default", () => {
      // The minimum-viable custom-discovery setup: just MCP_OIDC_DISCOVERY_URL.
      // All other fields default to safe values.
      const result = resolvePreset(undefined, {
        discoveryUrl: "https://example.com/.well-known/openid-configuration",
      });

      result.match(
        (config) => {
          expect(config.discoveryUrl).toBe("https://example.com/.well-known/openid-configuration");
          expect(config.scopes).toEqual(["openid", "email", "profile"]);
          expect(config.emailVerifiedPolicy).toBe("strict");
          expect(config.allowedAlgs).toEqual(["RS256"]);
          expect(config.presetName).toBeNull();
        },
        (error) => expect.fail(`Expected Ok but got Err: ${error.message}`),
      );
    });

    it("builds resolved config from overrides when all required fields present", () => {
      const discoveryUrl = "https://example.com/.well-known/openid-configuration";
      const scopes = ["openid", "email"];
      const emailVerifiedPolicy = "if-present" as const;
      const allowedAlgs = ["RS256", "ES256"];

      const result = resolvePreset(undefined, {
        discoveryUrl,
        scopes,
        emailVerifiedPolicy,
        allowedAlgs,
      });

      result.match(
        (config) => {
          expect(config.discoveryUrl).toBe(discoveryUrl);
          expect(config.scopes).toEqual(scopes);
          expect(config.emailVerifiedPolicy).toBe(emailVerifiedPolicy);
          expect(config.allowedAlgs).toEqual(allowedAlgs);
          expect(config.presetName).toBeNull();
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });
  });

  describe("resolvePreset - preset path", () => {
    it("resolves google preset without overrides", () => {
      const result = resolvePreset("google", {});

      result.match(
        (config) => {
          expect(config.presetName).toBe("google");
          expect(config.discoveryUrl).toBe("https://accounts.google.com/.well-known/openid-configuration");
          expect(config.scopes).toEqual(["openid", "email", "profile"]);
          expect(config.emailVerifiedPolicy).toBe("strict");
          expect(config.allowedAlgs).toEqual(["RS256"]);
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("returns err when tenant-bound preset lacks discoveryUrl override", () => {
      const result = resolvePreset("entra", {});

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.message).toContain("entra");
          expect(error.message).toContain("DISCOVERY_URL");
        },
      );
    });

    it("resolves tenant-bound preset when discoveryUrl override provided", () => {
      const discoveryUrl = "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration";

      const result = resolvePreset("entra", { discoveryUrl });

      result.match(
        (config) => {
          expect(config.presetName).toBe("entra");
          expect(config.discoveryUrl).toBe(discoveryUrl);
          expect(config.scopes).toEqual(["openid", "email", "profile"]);
          expect(config.emailVerifiedPolicy).toBe("strict");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("merges overrides with okta preset (overrides win)", () => {
      const discoveryUrl = "https://myorg.okta.com/.well-known/openid-configuration";
      const customScopes = ["openid", "email", "profile", "offline_access"];

      const result = resolvePreset("okta", {
        discoveryUrl,
        scopes: customScopes,
      });

      result.match(
        (config) => {
          expect(config.presetName).toBe("okta");
          expect(config.discoveryUrl).toBe(discoveryUrl);
          expect(config.scopes).toEqual(customScopes);
          expect(config.emailVerifiedPolicy).toBe("strict");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("merges overrides with auth0 preset", () => {
      const discoveryUrl = "https://myorg.auth0.com/.well-known/openid-configuration";

      const result = resolvePreset("auth0", { discoveryUrl });

      result.match(
        (config) => {
          expect(config.presetName).toBe("auth0");
          expect(config.discoveryUrl).toBe(discoveryUrl);
          expect(config.emailVerifiedPolicy).toBe("if-present");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("merges overrides with keycloak preset", () => {
      const discoveryUrl = "https://keycloak.example.com/auth/realms/myrealm/.well-known/openid-configuration";
      const allowedAlgs = ["RS256"];

      const result = resolvePreset("keycloak", {
        discoveryUrl,
        allowedAlgs,
      });

      result.match(
        (config) => {
          expect(config.presetName).toBe("keycloak");
          expect(config.discoveryUrl).toBe(discoveryUrl);
          expect(config.allowedAlgs).toEqual(allowedAlgs);
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("returns err for unknown preset name", () => {
      const result = resolvePreset("unknown" as any, {});

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.message).toContain("Unknown");
          expect(error.message).toContain("unknown");
        },
      );
    });
  });

  describe("resolvePreset - idiomatic neverthrow usage", () => {
    it("uses .match() pattern (not .isOk()/.isErr())", () => {
      // This is a style check - just verify the pattern works
      const result = resolvePreset("google", {});

      const outcome = result.match(
        (config) => ({ success: true as const, config }),
        (error) => ({ success: false as const, error }),
      );

      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.config.presetName).toBe("google");
      }
    });

    it("supports .andThen() chaining", () => {
      const initialResult = resolvePreset("google", {});
      const chainedResult = initialResult.andThen((config) => {
        // Verify we can chain operations
        const updatedConfig: ResolvedOAuthConfig = {
          ...config,
          clientId: "test-client",
          clientSecret: "test-secret",
          publicUrl: "https://example.com",
          trustProxy: false,
          allowlist: { emails: ["test@example.com"], subs: [] },
          redirectAllowlist: [],
        };
        return initialResult.map(() => updatedConfig);
      });

      chainedResult.match(
        () => {
          // Success case
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });
  });
});
