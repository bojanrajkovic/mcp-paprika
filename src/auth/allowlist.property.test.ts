import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { verifyIdentity } from "./allowlist.js";
import { arbitraryIdTokenPayload, arbitraryIdTokenPayloadWithEmail, arbitraryAllowlist } from "./test-utils.js";

describe("allowlist: property-based tests", () => {
  describe("Policy semantics", () => {
    it("Property 1: OR semantics over 2×2 (emailListed, subListed) — with 'skip' policy, admission = (emailListed OR subListed)", () => {
      fc.assert(
        fc.property(arbitraryIdTokenPayload(), arbitraryAllowlist(), (payload, allowlist) => {
          const result = verifyIdentity(payload, "skip", allowlist);

          const emailListed = payload.email ? allowlist.emails.has(payload.email) : false;
          const subListed = payload.sub ? allowlist.subs.has(payload.sub) : false;
          const shouldAdmit = emailListed || subListed;

          if (shouldAdmit) {
            result.match(
              () => {},
              () => expect.fail("Expected Ok but got Err"),
            );
          } else {
            result.match(
              () => expect.fail("Expected Err but got Ok"),
              () => {},
            );
          }
        }),
      );
    });

    it("Property 2: strict policy never admits when email is in list but email_verified !== true", () => {
      fc.assert(
        fc.property(arbitraryIdTokenPayloadWithEmail(), arbitraryAllowlist(), (payload, allowlist) => {
          // Force email to be in allowlist and email_verified to not be true
          const modifiedAllowlist = {
            ...allowlist,
            emails: new Set([...allowlist.emails, payload.email]),
            subs: new Set<string>(), // empty subs to force email path
          };
          const modifiedPayload = {
            ...payload,
            email_verified: undefined, // not true
          };

          const result = verifyIdentity(modifiedPayload, "strict", modifiedAllowlist);
          result.match(
            () => expect.fail("Expected Err but got Ok"),
            () => {},
          );
        }),
      );
    });

    it("Property 3: if-present policy admits when email_verified is missing, denies when email_verified === false", () => {
      fc.assert(
        fc.property(arbitraryIdTokenPayloadWithEmail(), arbitraryAllowlist(), (payload, allowlist) => {
          // Force email to be in allowlist and subs empty
          const modifiedAllowlist = {
            ...allowlist,
            emails: new Set([...allowlist.emails, payload.email]),
            subs: new Set<string>(),
          };

          // Test case 1: email_verified missing — should admit
          const payloadMissing = {
            ...payload,
            email_verified: undefined,
          };
          const resultMissing = verifyIdentity(payloadMissing, "if-present", modifiedAllowlist);
          resultMissing.match(
            () => {},
            () => expect.fail("Expected Ok but got Err for email_verified=undefined"),
          );

          // Test case 2: email_verified = false — should deny
          const payloadFalse = {
            ...payload,
            email_verified: false,
          };
          const resultFalse = verifyIdentity(payloadFalse, "if-present", modifiedAllowlist);
          resultFalse.match(
            () => expect.fail("Expected Err but got Ok for email_verified=false"),
            () => {},
          );
        }),
      );
    });

    it("Property 4: source is always 'email' or 'sub' for Ok results", () => {
      fc.assert(
        fc.property(arbitraryIdTokenPayload(), arbitraryAllowlist(), (payload, allowlist) => {
          const result = verifyIdentity(payload, "skip", allowlist);
          result.match(
            (identity) => {
              expect(["email", "sub"]).toContain(identity.source);
            },
            () => {
              // Err is acceptable
            },
          );
        }),
      );
    });
  });
});
