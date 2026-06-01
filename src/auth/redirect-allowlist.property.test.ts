import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalizeOrigin, isRecognizedOrigin } from "./redirect-allowlist.js";

describe("redirect-allowlist: property-based tests", () => {
  it("Property 1: normalizeOrigin is idempotent on valid https origins", () => {
    fc.assert(
      fc.property(fc.domain(), (host) => {
        const first = normalizeOrigin(`https://${host}/some/path?q=1`)._unsafeUnwrap();
        const second = normalizeOrigin(first)._unsafeUnwrap();
        expect(second).toBe(first);
      }),
    );
  });

  it("Property 2: recognition holds iff the redirect origin equals the single allowlisted origin", () => {
    fc.assert(
      fc.property(fc.domain(), fc.domain(), (allowHost, reqHost) => {
        const allowOrigin = `https://${allowHost.toLowerCase()}`;
        const set = new Set([allowOrigin]);
        const recognized = isRecognizedOrigin(`https://${reqHost}/cb`, set);
        const expected = `https://${reqHost.toLowerCase()}` === allowOrigin;
        expect(recognized).toBe(expected);
      }),
    );
  });

  it("Property 3: a sub-domain suffix of an allowlisted host is never recognized", () => {
    fc.assert(
      fc.property(fc.domain(), (host) => {
        const set = new Set([`https://${host.toLowerCase()}`]);
        expect(isRecognizedOrigin(`https://${host}.evil.example/cb`, set)).toBe(false);
      }),
    );
  });

  it("Property 4: an empty allowlist never recognizes anything", () => {
    fc.assert(
      fc.property(fc.webUrl(), (uri) => {
        expect(isRecognizedOrigin(uri, new Set())).toBe(false);
      }),
    );
  });
});
