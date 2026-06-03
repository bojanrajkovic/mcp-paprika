/**
 * Tests for OAuthError subclasses and OAuthTokenError factory methods
 */

import { describe, expect, it } from "vitest";

import { OAuthTokenError } from "./errors.js";

describe("OAuthTokenError", () => {
  describe("invalidGrant", () => {
    it("produces InvalidGrantError with correct wire code", () => {
      const error = OAuthTokenError.invalidGrant("grant expired");
      const response = error.toResponseObject();

      expect(response.error).toBe("invalid_grant");
      expect(response.error_description).toBe("grant expired");
      // Ensure error_uri is not set to the error code (the bug being fixed)
      expect(response.error_uri).toBeUndefined();
    });
  });

  describe("invalidToken", () => {
    it("produces InvalidTokenError with correct wire code", () => {
      const error = OAuthTokenError.invalidToken();
      const response = error.toResponseObject();

      expect(response.error).toBe("invalid_token");
    });
  });

  describe("invalidScope", () => {
    it("produces InvalidScopeError with correct wire code", () => {
      const error = OAuthTokenError.invalidScope("scope exceeds granted");
      const response = error.toResponseObject();

      expect(response.error).toBe("invalid_scope");
      expect(response.error_description).toBe("scope exceeds granted");
    });
  });

  describe("invalidTarget", () => {
    it("produces InvalidTargetError with correct wire code", () => {
      const error = OAuthTokenError.invalidTarget("target not found");
      const response = error.toResponseObject();

      expect(response.error).toBe("invalid_target");
      expect(response.error_description).toBe("target not found");
    });
  });
});
