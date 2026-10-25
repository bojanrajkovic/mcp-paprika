import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it } from "vitest";

import { requestSubject, subjectMatches } from "./subject.js";

function authInfo(extra: Record<string, unknown> | undefined): AuthInfo {
  return { token: "t", clientId: "c", scopes: [], ...(extra !== undefined ? { extra } : {}) };
}

describe("requestSubject", () => {
  it("reads the verified sub from AuthInfo.extra", () => {
    expect(requestSubject(authInfo({ email: "a@example.com", sub: "alice", source: "email" }))).toBe("alice");
  });

  it("is undefined when no AuthInfo was verified (dev-auth bypass)", () => {
    expect(requestSubject(undefined)).toBeUndefined();
  });

  it("reads sub even when another identity field doesn't parse", () => {
    expect(requestSubject(authInfo({ email: "not-an-email", sub: "alice", source: "email" }))).toBe("alice");
  });

  it("is undefined when extra carries no string sub", () => {
    expect(requestSubject(authInfo(undefined))).toBeUndefined();
    expect(requestSubject(authInfo({ sub: 42 }))).toBeUndefined();
  });
});

describe("subjectMatches", () => {
  it("matches the same subject", () => {
    expect(subjectMatches("alice", "alice")).toBe(true);
  });

  it("rejects a different subject", () => {
    expect(subjectMatches("mallory", "alice")).toBe(false);
  });

  it("rejects a subjectless request against a subject-owned session, and the reverse", () => {
    expect(subjectMatches(undefined, "alice")).toBe(false);
    expect(subjectMatches("alice", undefined)).toBe(false);
  });

  it("matches two subjectless sides (dev-auth bypass owns and uses the session)", () => {
    expect(subjectMatches(undefined, undefined)).toBe(true);
  });
});
