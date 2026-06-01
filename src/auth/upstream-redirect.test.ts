import { describe, it, expect, vi } from "vitest";
import type { Context } from "hono";
import { redirectUpstream } from "./upstream-redirect.js";
import { AuthRequestStore } from "./auth-request-store.js";

function makeDeps(authRequests: AuthRequestStore) {
  return {
    authRequests,
    authorizationEndpoint: "https://idp.example.com/authorize",
    upstreamClientId: "upstream-client-id",
    upstreamScopes: ["openid", "email"],
    publicUrl: "https://mcp.example.com",
  };
}

const approved = {
  clientId: "123e4567-e89b-12d3-a456-426614174000",
  codeChallenge: "challenge-123",
  redirectUri: "https://claude.ai/callback",
  resource: "https://mcp.example.com/",
  claudeState: "claude-state-123",
  scope: "openid email",
};

describe("redirectUpstream", () => {
  it("sets a 302 to the upstream authorize endpoint with our client_id, scope, state, nonce", () => {
    const authRequests = new AuthRequestStore();
    const ctx = {
      redirect: vi.fn((url: string, status: number) => new Response(null, { status, headers: { Location: url } })),
    } as unknown as Context;

    redirectUpstream(ctx, makeDeps(authRequests), approved);

    const redirect = ctx.redirect as unknown as ReturnType<typeof vi.fn>;
    expect(redirect).toHaveBeenCalledOnce();
    const url = new URL(redirect.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("upstream-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://mcp.example.com/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
  });

  it("persists an AuthRequestState keyed by ourState carrying the downstream context", () => {
    const authRequests = new AuthRequestStore();
    const ctx = {
      redirect: vi.fn((url: string, status: number) => new Response(null, { status, headers: { Location: url } })),
    } as unknown as Context;

    redirectUpstream(ctx, makeDeps(authRequests), approved);

    const redirect = ctx.redirect as unknown as ReturnType<typeof vi.fn>;
    const ourState = new URL(redirect.mock.calls[0]![0] as string).searchParams.get("state")!;
    const stored = authRequests.consume(ourState);
    expect(stored).not.toBeNull();
    expect(stored?.clientId).toBe(approved.clientId);
    expect(stored?.codeChallenge).toBe("challenge-123");
    expect(stored?.redirectUri).toBe("https://claude.ai/callback");
    expect(stored?.resource).toBe("https://mcp.example.com/");
    expect(stored?.claudeState).toBe("claude-state-123");
    expect(stored?.scope).toBe("openid email");
    expect(stored?.codeChallengeMethod).toBe("S256");
    expect(stored?.ourNonce).toBe(new URL(redirect.mock.calls[0]![0] as string).searchParams.get("nonce"));
  });
});
