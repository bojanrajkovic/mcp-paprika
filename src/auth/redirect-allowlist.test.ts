import { describe, expect, it } from "vitest";

import { isRecognizedOrigin, normalizeOrigin } from "./redirect-allowlist.js";

describe("normalizeOrigin", () => {
  it("returns the origin for a bare https origin", () => {
    normalizeOrigin("https://claude.ai").match(
      (o) => expect(o).toBe("https://claude.ai"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("strips path/query, keeping only the origin", () => {
    normalizeOrigin("https://claude.ai/api/mcp/auth_callback?x=1").match(
      (o) => expect(o).toBe("https://claude.ai"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("elides the default https port (:443)", () => {
    normalizeOrigin("https://claude.ai:443").match(
      (o) => expect(o).toBe("https://claude.ai"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("preserves a non-default port", () => {
    normalizeOrigin("https://claude.ai:8443").match(
      (o) => expect(o).toBe("https://claude.ai:8443"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("lowercases the host", () => {
    normalizeOrigin("https://Claude.AI/cb").match(
      (o) => expect(o).toBe("https://claude.ai"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("strips userinfo from the origin", () => {
    normalizeOrigin("https://user:pass@claude.ai/cb").match(
      (o) => expect(o).toBe("https://claude.ai"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("permits http for localhost (loopback exemption)", () => {
    normalizeOrigin("http://localhost").match(
      (o) => expect(o).toBe("http://localhost"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("permits http for 127.0.0.1 with a port", () => {
    normalizeOrigin("http://127.0.0.1:8080").match(
      (o) => expect(o).toBe("http://127.0.0.1:8080"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("permits http for [::1] (bracketed IPv6 loopback)", () => {
    normalizeOrigin("http://[::1]").match(
      (o) => expect(o).toBe("http://[::1]"),
      (e) => expect.fail(`expected ok, got ${e.message}`),
    );
  });

  it("rejects http for a non-loopback host", () => {
    normalizeOrigin("http://evil.example.com").match(
      (o) => expect.fail(`expected err, got ok ${o}`),
      (e) => expect(e.name).toBe("OAuthConfigError"),
    );
  });

  it("rejects a non-http(s) scheme (ftp)", () => {
    normalizeOrigin("ftp://files.example.com").match(
      (o) => expect.fail(`expected err, got ok ${o}`),
      (e) => expect(e.name).toBe("OAuthConfigError"),
    );
  });

  it("rejects an opaque/non-special scheme (data:)", () => {
    normalizeOrigin("data:text/plain,hello").match(
      (o) => expect.fail(`expected err, got ok ${o}`),
      (e) => expect(e.name).toBe("OAuthConfigError"),
    );
  });

  it("rejects a scheme-less value that does not parse as an absolute URL", () => {
    normalizeOrigin("claude.ai").match(
      (o) => expect.fail(`expected err, got ok ${o}`),
      (e) => expect(e.name).toBe("OAuthConfigError"),
    );
  });

  it("rejects an unparseable value", () => {
    normalizeOrigin("not a url at all").match(
      (o) => expect.fail(`expected err, got ok ${o}`),
      (e) => expect(e.name).toBe("OAuthConfigError"),
    );
  });

  it("is idempotent on an already-normalized origin", () => {
    const once = normalizeOrigin("https://claude.ai/cb")._unsafeUnwrap();
    const twice = normalizeOrigin(once)._unsafeUnwrap();
    expect(twice).toBe(once);
  });
});

describe("isRecognizedOrigin", () => {
  const allow = new Set(["https://claude.ai", "https://claude.com"]);

  it("recognizes a redirect_uri whose origin is allowlisted", () => {
    expect(isRecognizedOrigin("https://claude.ai/api/mcp/auth_callback", allow)).toBe(true);
  });

  it("recognizes regardless of path, query, and default port", () => {
    expect(isRecognizedOrigin("https://claude.ai:443/x?y=z", allow)).toBe(true);
  });

  it("does not recognize a different host", () => {
    expect(isRecognizedOrigin("https://evil.example.com/cb", allow)).toBe(false);
  });

  it("does not recognize a suffix-spoofed host", () => {
    expect(isRecognizedOrigin("https://claude.ai.evil.com/cb", allow)).toBe(false);
  });

  it("does not recognize a prefix-spoofed host", () => {
    expect(isRecognizedOrigin("https://evil-claude.ai/cb", allow)).toBe(false);
  });

  it("does not recognize a non-default port on an allowlisted host", () => {
    expect(isRecognizedOrigin("https://claude.ai:8443/cb", allow)).toBe(false);
  });

  it("fails closed on an empty allowlist", () => {
    expect(isRecognizedOrigin("https://claude.ai/cb", new Set())).toBe(false);
  });

  it("fails closed on an unparseable redirect_uri", () => {
    expect(isRecognizedOrigin("::::not-a-url", allow)).toBe(false);
  });

  it("recognizes an exact loopback origin including port", () => {
    expect(isRecognizedOrigin("http://127.0.0.1:8080/cb", new Set(["http://127.0.0.1:8080"]))).toBe(true);
  });

  it("does not recognize a loopback with a different (ephemeral) port — fail-closed per RFC 8252", () => {
    expect(isRecognizedOrigin("http://localhost:51004/cb", new Set(["http://localhost"]))).toBe(false);
  });

  it("does not recognize an http non-loopback origin even if smuggled into the set", () => {
    // The set can never legitimately contain this (normalizeOrigin rejects it),
    // but the matcher must still re-check protocol and refuse to trust it.
    expect(isRecognizedOrigin("http://evil.example.com/cb", new Set(["http://evil.example.com"]))).toBe(false);
  });
});
