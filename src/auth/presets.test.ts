/**
 * Tests for OIDC preset table and resolver
 */

import { describe, it, expect } from "vitest";
import { resolvePreset, OIDC_PRESETS } from "./presets.js";
import type { ResolvedOAuthConfig } from "./types.js";

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
      const preset = OIDC_PRESETS.entra;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBeUndefined();
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("strict");
      expect(preset.allowedAlgs).toEqual(["RS256"]);
    });

    it("contains okta preset without discoveryUrl", () => {
      const preset = OIDC_PRESETS.okta;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBeUndefined();
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("strict");
      expect(preset.allowedAlgs).toEqual(["RS256"]);
    });

    it("contains auth0 preset without discoveryUrl", () => {
      const preset = OIDC_PRESETS.auth0;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBeUndefined();
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("if-present");
      expect(preset.allowedAlgs).toEqual(["RS256"]);
    });

    it("contains keycloak preset without discoveryUrl", () => {
      const preset = OIDC_PRESETS.keycloak;
      expect(preset).toBeDefined();
      expect(preset.discoveryUrl).toBeUndefined();
      expect(preset.scopes).toEqual(["openid", "email", "profile"]);
      expect(preset.emailVerifiedPolicy).toBe("strict");
      expect(preset.allowedAlgs).toEqual(["RS256", "ES256"]);
    });

    it("is readonly", () => {
      expect(OIDC_PRESETS).toBeDefined();
      // Should not be able to modify (TypeScript check, but test validates intent)
      expect(Object.isFrozen(OIDC_PRESETS) || !Object.isExtensible(OIDC_PRESETS)).toBe(true);
    });
  });

  describe("resolvePreset - custom discovery URL path (name === undefined)", () => {
    it("returns err when discoveryUrl is missing", () => {
      const result = resolvePreset(undefined, {
        scopes: ["openid"],
        emailVerifiedPolicy: "strict",
        allowedAlgs: ["RS256"],
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("discoveryUrl");
      }
    });

    it("returns err when scopes is missing", () => {
      const result = resolvePreset(undefined, {
        discoveryUrl: "https://example.com/.well-known/openid-configuration",
        emailVerifiedPolicy: "strict",
        allowedAlgs: ["RS256"],
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("scopes");
      }
    });

    it("returns err when emailVerifiedPolicy is missing", () => {
      const result = resolvePreset(undefined, {
        discoveryUrl: "https://example.com/.well-known/openid-configuration",
        scopes: ["openid"],
        allowedAlgs: ["RS256"],
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("emailVerifiedPolicy");
      }
    });

    it("returns err when allowedAlgs is missing", () => {
      const result = resolvePreset(undefined, {
        discoveryUrl: "https://example.com/.well-known/openid-configuration",
        scopes: ["openid"],
        emailVerifiedPolicy: "strict",
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("allowedAlgs");
      }
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

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.discoveryUrl).toBe(discoveryUrl);
        expect(result.value.scopes).toEqual(scopes);
        expect(result.value.emailVerifiedPolicy).toBe(emailVerifiedPolicy);
        expect(result.value.allowedAlgs).toEqual(allowedAlgs);
        expect(result.value.presetName).toBeNull();
      }
    });
  });

  describe("resolvePreset - preset path", () => {
    it("resolves google preset without overrides", () => {
      const result = resolvePreset("google", {});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.presetName).toBe("google");
        expect(result.value.discoveryUrl).toBe("https://accounts.google.com/.well-known/openid-configuration");
        expect(result.value.scopes).toEqual(["openid", "email", "profile"]);
        expect(result.value.emailVerifiedPolicy).toBe("strict");
        expect(result.value.allowedAlgs).toEqual(["RS256"]);
      }
    });

    it("returns err when tenant-bound preset lacks discoveryUrl override", () => {
      const result = resolvePreset("entra", {});

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("entra");
        expect(result.error.message).toContain("DISCOVERY_URL");
      }
    });

    it("resolves tenant-bound preset when discoveryUrl override provided", () => {
      const discoveryUrl = "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration";

      const result = resolvePreset("entra", { discoveryUrl });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.presetName).toBe("entra");
        expect(result.value.discoveryUrl).toBe(discoveryUrl);
        expect(result.value.scopes).toEqual(["openid", "email", "profile"]);
        expect(result.value.emailVerifiedPolicy).toBe("strict");
      }
    });

    it("merges overrides with okta preset (overrides win)", () => {
      const discoveryUrl = "https://myorg.okta.com/.well-known/openid-configuration";
      const customScopes = ["openid", "email", "profile", "offline_access"];

      const result = resolvePreset("okta", {
        discoveryUrl,
        scopes: customScopes,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.presetName).toBe("okta");
        expect(result.value.discoveryUrl).toBe(discoveryUrl);
        expect(result.value.scopes).toEqual(customScopes);
        expect(result.value.emailVerifiedPolicy).toBe("strict");
      }
    });

    it("merges overrides with auth0 preset", () => {
      const discoveryUrl = "https://myorg.auth0.com/.well-known/openid-configuration";

      const result = resolvePreset("auth0", { discoveryUrl });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.presetName).toBe("auth0");
        expect(result.value.discoveryUrl).toBe(discoveryUrl);
        expect(result.value.emailVerifiedPolicy).toBe("if-present");
      }
    });

    it("merges overrides with keycloak preset", () => {
      const discoveryUrl = "https://keycloak.example.com/auth/realms/myrealm/.well-known/openid-configuration";
      const allowedAlgs = ["RS256"];

      const result = resolvePreset("keycloak", {
        discoveryUrl,
        allowedAlgs,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.presetName).toBe("keycloak");
        expect(result.value.discoveryUrl).toBe(discoveryUrl);
        expect(result.value.allowedAlgs).toEqual(allowedAlgs);
      }
    });

    it("returns err for unknown preset name", () => {
      const result = resolvePreset("unknown" as any, {});

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("Unknown");
        expect(result.error.message).toContain("unknown");
      }
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
          allowlist: { emails: ["test@example.com"], subs: [] },
        };
        return initialResult.map(() => updatedConfig);
      });

      expect(chainedResult.isOk()).toBe(true);
    });
  });
});
