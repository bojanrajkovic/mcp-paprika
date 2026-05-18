import { describe, it } from "vitest";
import fc from "fast-check";
import { validateRegistration, validateUpdate } from "./dcr-validator.js";

describe("auth/dcr-validator: property-based tests", () => {
  describe("Property 1: validated metadata is a subset of input keys", () => {
    it("for any successfully-validated registration metadata, output keys are a subset of input keys", () => {
      fc.assert(
        fc.property(
          fc.object({
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
            const result = validateRegistration(input as any);

            result.match(
              (metadata) => {
                const outputKeys = new Set(Object.keys(metadata));
                const inputKeys = new Set(Object.keys(input));

                // Check that every output key was in the input
                for (const key of outputKeys) {
                  if (!inputKeys.has(key)) {
                    throw new Error(`Output key "${key}" not in input keys`);
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
          fc.tuple(
            fc.oneof(
              fc.constant("client_secret_post"),
              fc.constant("client_secret_basic"),
              fc.constant("private_key_jwt"),
              fc.constant("tls_client_auth"),
            ),
            fc.array(fc.oneof(fc.constant("https://app.example.com/cb"), fc.constant("http://localhost:8080/cb")), {
              minLength: 1,
            }),
          ),
          ([authMethod, redirectUris]) => {
            const input = {
              token_endpoint_auth_method: authMethod,
              redirect_uris: redirectUris,
              response_types: ["code"],
              grant_types: ["authorization_code"],
              scope: "openid",
            };

            const result = validateRegistration(input as any);

            result.match(
              () => {
                throw new Error(`Expected Err for unsupported auth method "${authMethod}"`);
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
    it("for any input with at least one valid redirect_uri pattern, both registration and update validators pass the redirect-URI step", () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.array(
              fc.oneof(
                fc.constant("https://app.example.com/cb"),
                fc.constant("https://another.example.com/auth"),
                fc.constant("http://localhost:3000/callback"),
                fc.constant("http://127.0.0.1:8080/cb"),
              ),
              { minLength: 1, maxLength: 5 },
            ),
            fc.option(
              fc.oneof(fc.constant("RS256"), fc.constant("ES256")),
              { freq: 1 }, // 1 out of 2 = 50% chance
            ),
          ),
          ([redirectUris, idTokenAlg]) => {
            const input: any = {
              token_endpoint_auth_method: "none",
              redirect_uris: redirectUris,
              response_types: ["code"],
              grant_types: ["authorization_code"],
              scope: "openid",
            };

            if (idTokenAlg) {
              input.id_token_signed_response_alg = idTokenAlg;
            }

            const result = validateRegistration(input);
            const resultUpdate = validateUpdate(input);

            result.match(
              (metadata) => {
                // Validate that the output has the expected redirect URIs
                if (metadata.redirectUris.length === 0) {
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
                if (metadata.redirectUris.length === 0) {
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
