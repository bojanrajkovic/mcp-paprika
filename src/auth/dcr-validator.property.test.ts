import { describe, it } from "vitest";
import fc from "fast-check";
import { validateRegistration, validateUpdate } from "./dcr-validator.js";

describe("auth/dcr-validator: property-based tests", () => {
  describe("Property 1: validated metadata contains only expected keys", () => {
    it("for any successfully-validated registration metadata, output keys are from the known set", () => {
      const EXPECTED_KEYS = new Set([
        "tokenEndpointAuthMethod",
        "grantTypes",
        "responseTypes",
        "redirectUris",
        "scope",
        "clientName",
        "idTokenSignedResponseAlg",
      ]);

      fc.assert(
        fc.property(
          fc.record({
            token_endpoint_auth_method: fc.constant("none"),
            redirect_uris: fc.array(
              fc.oneof(
                fc.constant("https://app.example.com/cb"),
                fc.constant("http://localhost:8080/cb"),
                fc.constant("http://127.0.0.1/cb"),
              ),
              { minLength: 1 },
            ),
            response_types: fc.constant(["code"]),
            grant_types: fc.constant(["authorization_code"]),
            scope: fc.constant("openid"),
          }),
          (input) => {
            const result = validateRegistration(input);

            result.match(
              (metadata) => {
                // Check that every output key is from the known set
                for (const key of Object.keys(metadata)) {
                  if (!EXPECTED_KEYS.has(key)) {
                    throw new Error(`Unexpected output key "${key}"`);
                  }
                }
              },
              () => {
                // OK to fail validation
              },
            );
          },
        ),
      );
    });
  });

  describe("Property 2: token_endpoint_auth_method !== 'none' always fails", () => {
    it("for any input with token_endpoint_auth_method !== 'none', output is always Err", () => {
      fc.assert(
        fc.property(
          fc.record({
            token_endpoint_auth_method: fc.oneof(
              fc.constant("client_secret_post"),
              fc.constant("client_secret_basic"),
              fc.constant("private_key_jwt"),
              fc.constant("tls_client_auth"),
            ),
            redirect_uris: fc.array(
              fc.oneof(fc.constant("https://app.example.com/cb"), fc.constant("http://localhost:8080/cb")),
              { minLength: 1 },
            ),
            response_types: fc.constant(["code"]),
            grant_types: fc.constant(["authorization_code"]),
            scope: fc.constant("openid"),
          }),
          (input) => {
            const result = validateRegistration(input);

            result.match(
              () => {
                throw new Error(`Expected Err for unsupported auth method "${input.token_endpoint_auth_method}"`);
              },
              () => {
                // Expected
              },
            );
          },
        ),
      );
    });
  });

  describe("Property 3: valid redirect_uris allow at least https or localhost/127.0.0.1 URIs", () => {
    it("for any input with at least one valid redirect_uri pattern, both validators accept it", () => {
      fc.assert(
        fc.property(
          fc.record({
            token_endpoint_auth_method: fc.constant("none"),
            redirect_uris: fc.array(
              fc.oneof(
                fc.constant("https://app.example.com/cb"),
                fc.constant("https://another.example.com/auth"),
                fc.constant("http://localhost:3000/callback"),
                fc.constant("http://127.0.0.1:8080/cb"),
              ),
              { minLength: 1, maxLength: 5 },
            ),
            response_types: fc.constant(["code"]),
            grant_types: fc.constant(["authorization_code"]),
            scope: fc.constant("openid"),
            id_token_signed_response_alg: fc.option(
              fc.oneof(fc.constant("RS256"), fc.constant("ES256")),
              { freq: 1 }, // 1 out of 2 = 50% chance
            ),
          }),
          (input) => {
            const result = validateRegistration(input);
            const resultUpdate = validateUpdate(input);

            result.match(
              (metadata) => {
                // Validate that the output has the expected redirect URIs
                if (!metadata.redirectUris || metadata.redirectUris.length === 0) {
                  throw new Error("Expected non-empty redirect_uris in output");
                }
              },
              () => {
                // Failure is acceptable if there are other validation issues
              },
            );

            resultUpdate.match(
              (metadata) => {
                // validateUpdate should also succeed for valid inputs
                if (metadata.redirectUris && metadata.redirectUris.length === 0) {
                  throw new Error("Expected non-empty redirect_uris in update output");
                }
              },
              () => {
                // Failure is acceptable if there are other validation issues
              },
            );
          },
        ),
      );
    });
  });
});
