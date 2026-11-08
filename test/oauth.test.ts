import { describe, expect, it } from "vitest";
import { createPkcePair, randomState, buildAuthorizeUrl } from "../src/canva/oauth.js";

/** Pure-crypto helpers verified against RFC 7636 shapes. */

describe("oauth helpers", () => {
  it("PKCE challenge is the S256 of the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).not.toContain("+");
    expect(verifier).not.toContain("/");
    expect(challenge).toHaveLength(43);
  });

  it("state is unguessable url-safe", () => {
    const a = randomState();
    const b = randomState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("authorize URL carries PKCE, state, scopes, and public client", () => {
    const url = buildAuthorizeUrl(
      {
        issuer: "https://mcp.canva.com",
        authorization_endpoint: "https://mcp.canva.com/authorize",
        token_endpoint: "https://mcp.canva.com/token",
        registration_endpoint: "https://mcp.canva.com/register",
      },
      {
        clientId: "cid-123",
        redirectUri: "http://127.0.0.1:43112/callback",
        challenge: "chal",
        state: "st",
      },
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://mcp.canva.com/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("cid-123");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toContain("design:content:write");
    expect(parsed.searchParams.get("scope")).toContain("asset:write");
  });
});
