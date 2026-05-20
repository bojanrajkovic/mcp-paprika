import { describe, it, expect } from "vitest";
import { validateRegistration, validateUpdate } from "./dcr-validator.js";

describe("auth/dcr-validator: RFC 7591/7592 metadata validation", () => {
  describe("token_endpoint_auth_method", () => {
    it("registration: token_endpoint_auth_method=none accepted", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        (metadata) => {
          expect(metadata.tokenEndpointAuthMethod).toBe("none");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("registration: token_endpoint_auth_method=client_secret_post rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "client_secret_post",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
          // Error mentions unsupported auth method
          expect(error.message.toLowerCase()).toContain("none");
        },
      );
    });

    it("registration: token_endpoint_auth_method=client_secret_basic rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "client_secret_basic",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });

    it("registration: token_endpoint_auth_method=private_key_jwt rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "private_key_jwt",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });

    it("registration: token_endpoint_auth_method=client_secret_jwt rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "client_secret_jwt",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });
  });

  describe("grant_types", () => {
    it("registration: grant_types=[password] rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["password"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });

    it("registration: grant_types=[client_credentials] rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["client_credentials"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });
  });

  describe("response_types", () => {
    it("registration: response_types=[code,token] rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code", "token"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });
  });

  describe("redirect_uris", () => {
    it("registration: redirect_uri=http://example.com rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["http://example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });

    it("registration: redirect_uri=http://localhost:1234/cb accepted", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["http://localhost:1234/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        (metadata) => {
          expect(metadata.redirectUris).toContain("http://localhost:1234/cb");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("registration: redirect_uri=http://127.0.0.1/cb accepted", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["http://127.0.0.1/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        (metadata) => {
          expect(metadata.redirectUris).toContain("http://127.0.0.1/cb");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("registration: redirect_uri=http://[::1]/cb accepted (IPv6 loopback)", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["http://[::1]/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        (metadata) => {
          expect(metadata.redirectUris).toContain("http://[::1]/cb");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("registration: redirect_uri=https://app.com/cb accepted", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["https://app.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        (metadata) => {
          expect(metadata.redirectUris).toContain("https://app.com/cb");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("registration: redirect_uri=file:///x rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["file:///x"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });

    it("registration: redirect_uris empty array rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: [],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });
  });

  describe("id_token_signed_response_alg", () => {
    it("registration: id_token_signed_response_alg=HS256 rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
        id_token_signed_response_alg: "HS256",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });

    it("registration: id_token_signed_response_alg=none rejected", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
        id_token_signed_response_alg: "none",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });

    it("registration: id_token_signed_response_alg=RS256 accepted", () => {
      const result = validateRegistration({
        token_endpoint_auth_method: "none",
        redirect_uris: ["https://app.example.com/cb"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        scope: "openid",
        id_token_signed_response_alg: "RS256",
      });

      result.match(
        (metadata) => {
          expect(metadata.idTokenSignedResponseAlg).toBe("RS256");
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });
  });

  describe("update semantics (partial validation)", () => {
    it("update: omitted fields accepted (partial update)", () => {
      const result = validateUpdate({
        // Only updating redirect_uris, omitting everything else
        redirect_uris: ["https://new-app.example.com/cb"],
      });

      result.match(
        (metadata) => {
          expect(metadata.redirectUris).toContain("https://new-app.example.com/cb");
          // Omitted fields should be absent (undefined), not synthesized with defaults
          expect(metadata.tokenEndpointAuthMethod).toBeUndefined();
          expect(metadata.grantTypes).toBeUndefined();
          expect(metadata.responseTypes).toBeUndefined();
          expect(metadata.scope).toBeUndefined();
        },
        () => expect.fail("Expected Ok but got Err"),
      );
    });

    it("update: present-but-invalid fields rejected (partial validation still strict)", () => {
      const result = validateUpdate({
        redirect_uris: ["https://app.example.com/cb"],
        token_endpoint_auth_method: "client_secret_post",
      });

      result.match(
        () => expect.fail("Expected Err but got Ok"),
        (error) => {
          expect(error.name).toBe("OAuthMetadataValidationError");
        },
      );
    });
  });
});
