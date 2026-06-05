import { describe, expect, it } from "vitest";

import type { IdTokenPayload } from "./types.js";

import { verifyIdentity } from "./allowlist.js";
import { OAuthAllowlistDenialError } from "./errors.js";
import { nowSeconds } from "./tokens.js";

// Test helper to create minimal id_token payloads
function createPayload(overrides: Partial<IdTokenPayload> = {}): IdTokenPayload {
  return {
    iss: "https://accounts.google.com",
    sub: "google-sub-123",
    aud: "client-id",
    nonce: "nonce-value",
    exp: nowSeconds() + 3600,
    iat: nowSeconds(),
    ...overrides,
  };
}

describe("auth/allowlist: identity verification against email/sub lists", () => {
  describe("Email-verified policy tests", () => {
    it("allowlisted email + email_verified=true admits with source=email", () => {
      const payload = createPayload({
        email: "user@example.com",
        email_verified: true,
        sub: "sub-123",
      });
      const allowlist = {
        emails: new Set(["user@example.com"]),
        subs: new Set<string>(),
      };
      const result = verifyIdentity(payload, "strict", allowlist);

      result.match(
        (identity) => {
          expect(identity).toEqual({
            email: "user@example.com",
            sub: "sub-123",
            source: "email",
          });
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("allowlisted sub admits with source=sub regardless of email_verified=false", () => {
      const payload = createPayload({
        email: "user@example.com",
        email_verified: false,
        sub: "sub-456",
      });
      const allowlist = {
        emails: new Set<string>(),
        subs: new Set(["sub-456"]),
      };
      const result = verifyIdentity(payload, "strict", allowlist);

      result.match(
        (identity) => {
          expect(identity).toEqual({
            email: "user@example.com",
            sub: "sub-456",
            source: "sub",
          });
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("both lists match → admitted with source=email (email-precedence)", () => {
      const payload = createPayload({
        email: "user@example.com",
        email_verified: true,
        sub: "sub-789",
      });
      const allowlist = {
        emails: new Set(["user@example.com"]),
        subs: new Set(["sub-789"]),
      };
      const result = verifyIdentity(payload, "strict", allowlist);

      result.match(
        (identity) => {
          expect(identity.source).toBe("email");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("neither list matches → err notAllowlisted", () => {
      const payload = createPayload({
        email: "unknown@example.com",
        email_verified: true,
        sub: "unknown-sub",
      });
      const allowlist = {
        emails: new Set(["user@example.com"]),
        subs: new Set(["sub-123"]),
      };
      const result = verifyIdentity(payload, "strict", allowlist);

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error).toBeInstanceOf(OAuthAllowlistDenialError);
          expect(error.name).toBe("OAuthAllowlistDenialError");
        },
      );
    });

    it("allowlisted email + email_verified=false + strict → err emailNotVerified", () => {
      const payload = createPayload({
        email: "user@example.com",
        email_verified: false,
        sub: "sub-123",
      });
      const allowlist = {
        emails: new Set(["user@example.com"]),
        subs: new Set<string>(),
      };
      const result = verifyIdentity(payload, "strict", allowlist);

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error).toBeInstanceOf(OAuthAllowlistDenialError);
        },
      );
    });

    it("allowlisted email + email_verified=false + skip → admitted", () => {
      const payload = createPayload({
        email: "user@example.com",
        email_verified: false,
        sub: "sub-123",
      });
      const allowlist = {
        emails: new Set(["user@example.com"]),
        subs: new Set<string>(),
      };
      const result = verifyIdentity(payload, "skip", allowlist);

      result.match(
        (identity) => {
          expect(identity).toEqual({
            email: "user@example.com",
            sub: "sub-123",
            source: "email",
          });
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("allowlisted email + email_verified claim absent + strict → err", () => {
      const payload = createPayload({
        email: "user@example.com",
        email_verified: undefined,
        sub: "sub-123",
      });
      const allowlist = {
        emails: new Set(["user@example.com"]),
        subs: new Set<string>(),
      };
      const result = verifyIdentity(payload, "strict", allowlist);

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error).toBeInstanceOf(OAuthAllowlistDenialError);
        },
      );
    });

    it("allowlisted email + email_verified claim absent + if-present → admitted", () => {
      const payload = createPayload({
        email: "user@example.com",
        email_verified: undefined,
        sub: "sub-123",
      });
      const allowlist = {
        emails: new Set(["user@example.com"]),
        subs: new Set<string>(),
      };
      const result = verifyIdentity(payload, "if-present", allowlist);

      result.match(
        (identity) => {
          expect(identity).toEqual({
            email: "user@example.com",
            sub: "sub-123",
            source: "email",
          });
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });
  });

  describe("Additional edge cases", () => {
    it("admits by sub when email is missing entirely", () => {
      const payload = createPayload({
        email: undefined,
        sub: "sub-456",
      });
      const allowlist = {
        emails: new Set<string>(),
        subs: new Set(["sub-456"]),
      };
      const result = verifyIdentity(payload, "strict", allowlist);

      result.match(
        (identity) => {
          expect(identity.source).toBe("sub");
          expect(identity.email).toBeNull();
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("admits via sub when both lists hit but email fails policy", () => {
      const payload = createPayload({
        email: "user@example.com",
        email_verified: false,
        sub: "sub-789",
      });
      const allowlist = {
        emails: new Set(["user@example.com"]),
        subs: new Set(["sub-789"]),
      };
      const result = verifyIdentity(payload, "strict", allowlist);

      result.match(
        (identity) => {
          expect(identity.source).toBe("sub");
          expect(identity.email).toBe("user@example.com");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });
  });
});
