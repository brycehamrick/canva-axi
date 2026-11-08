import { createHash, randomBytes } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import {
  readConfig,
  updateConfig,
  type CanvaTokenSet,
} from "./config.js";
import { VERSION } from "../version.js";

/**
 * OAuth 2.0 against the Canva MCP authorization server.
 *
 * The flow follows the MCP authorization spec: discover protected-resource
 * and authorization-server metadata, register a public client dynamically
 * (RFC 7591, token_endpoint_auth_method "none"), and run a PKCE S256
 * authorization-code grant over a loopback redirect.
 *
 * Endpoints verified live against https://mcp.canva.com (2026-11):
 *   /.well-known/oauth-protected-resource   → resource + scopes
 *   /.well-known/oauth-authorization-server → authorize/register/token/revoke
 *
 * Every fetch takes explicit endpoints so tests can drive a fake
 * authorization server without network access.
 */

export const DEFAULT_SERVER = "https://mcp.canva.com";
export const MCP_PATH = "/mcp";

/**
 * Every scope the Canva MCP server advertises (scopes_supported, verified
 * live). Requesting all of them lets the user approve once; Canva grants
 * what the account's plan supports.
 */
export const CANVA_SCOPES = [
  "profile:read",
  "design:meta:read",
  "design:content:read",
  "design:content:write",
  "folder:read",
  "folder:write",
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "brandtemplate:content:write",
  "comment:read",
  "comment:write",
  "asset:read",
  "asset:write",
  "brandkit:read",
  "help:answers:read",
  "help:answers:write",
];

const FETCH_TIMEOUT_MS = 20_000;

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint?: string;
  grant_types_supported?: string[];
  scopes_supported?: string[];
}

function httpsUrl(value: unknown, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new AxiError(`Canva OAuth metadata has an invalid ${label}`, "UPSTREAM", [
      "retry; if it persists, check https://www.canva.dev/docs/apps/mcp/troubleshooting/",
    ]);
  }
  if (parsed.protocol !== "https:") {
    throw new AxiError(`Canva OAuth ${label} must use HTTPS`, "VALIDATION_ERROR", [
      `use the default server ${DEFAULT_SERVER}`,
    ]);
  }
  return parsed;
}

function serverError(message: string): AxiError {
  return new AxiError(message, "UPSTREAM", [
    "check your network connection and retry",
    "if it persists, see https://www.canva.dev/docs/apps/mcp/troubleshooting/",
  ]);
}

export async function fetchAuthorizationServerMetadata(
  server = DEFAULT_SERVER,
): Promise<AuthorizationServerMetadata> {
  const base = httpsUrl(server, "server");
  const response = await fetch(`${base.origin}/.well-known/oauth-authorization-server`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => {
    throw serverError("could not reach Canva OAuth discovery endpoint");
  });
  if (!response.ok) {
    throw new AxiError(`Canva OAuth discovery failed (HTTP ${response.status})`, "UPSTREAM", [
      "retry `canva-axi auth login`",
    ]);
  }
  const metadata = (await response.json().catch(() => {
    throw serverError("Canva OAuth discovery returned non-JSON");
  })) as AuthorizationServerMetadata;
  for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"] as const) {
    if (!metadata?.[key]) {
      throw new AxiError(`Canva OAuth metadata is missing ${key}`, "UPSTREAM", [
        "retry `canva-axi auth login`",
      ]);
    }
    httpsUrl(metadata[key], key);
  }
  return metadata;
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(randomBytes(24));
}

export async function registerDynamicClient(
  metadata: AuthorizationServerMetadata,
  redirectUri: string,
): Promise<string> {
  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: `canva-axi/${VERSION}`,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: CANVA_SCOPES.join(" "),
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => {
    throw serverError("could not reach Canva client registration endpoint");
  });
  if (!response.ok) {
    throw new AxiError(`Canva client registration failed (HTTP ${response.status})`, "UPSTREAM", [
      "retry `canva-axi auth login`",
    ]);
  }
  const registered = (await response.json().catch(() => null)) as { client_id?: string } | null;
  if (!registered?.client_id) {
    throw new AxiError("Canva client registration returned no client_id", "UPSTREAM", [
      "retry `canva-axi auth login`",
    ]);
  }
  return registered.client_id;
}

export function buildAuthorizeUrl(
  metadata: AuthorizationServerMetadata,
  input: {
    clientId: string;
    redirectUri: string;
    challenge: string;
    state: string;
  },
): string {
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", CANVA_SCOPES.join(" "));
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  return url.toString();
}

function tokenError(message: string, status: number): AxiError {
  if (status === 401 || status === 400) {
    return new AxiError(`Canva rejected the token exchange: ${message}`, "AUTH", [
      "run `canva-axi auth login` again",
    ]);
  }
  return new AxiError(`Canva token endpoint error (HTTP ${status}): ${message}`, "UPSTREAM", [
    "retry; if it persists, run `canva-axi auth login` again",
  ]);
}

async function postForm(
  endpoint: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => {
    throw serverError("could not reach Canva token endpoint");
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}

function normalizeTokenSet(
  body: Record<string, unknown>,
  previous?: CanvaTokenSet,
): CanvaTokenSet {
  const access_token = typeof body.access_token === "string" ? body.access_token : undefined;
  if (!access_token) {
    throw new AxiError("Canva token response contained no access_token", "UPSTREAM", [
      "run `canva-axi auth login` again",
    ]);
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;
  return {
    access_token,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : previous?.refresh_token,
    expires_at: expiresIn !== undefined ? Date.now() + expiresIn * 1000 : previous?.expires_at,
    client_id: previous?.client_id,
    registered_at: previous?.registered_at,
  };
}

export async function exchangeAuthorizationCode(
  metadata: AuthorizationServerMetadata,
  input: { clientId: string; redirectUri: string; code: string; verifier: string },
): Promise<CanvaTokenSet> {
  const { ok, status, body } = await postForm(metadata.token_endpoint, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier,
  });
  if (!ok) {
    throw tokenError(String(body.error_description ?? body.error ?? "unknown error"), status);
  }
  const stored: CanvaTokenSet = {
    ...normalizeTokenSet(body),
    client_id: input.clientId,
    registered_at: Date.now(),
  };
  updateConfig((current) => ({ ...current, tokens: stored }));
  return stored;
}

/** Refresh the stored token set. Throws AUTH when no refresh token exists. */
export async function refreshAccessToken(
  metadata: AuthorizationServerMetadata,
): Promise<CanvaTokenSet> {
  const tokens = readConfig().tokens;
  if (!tokens?.refresh_token) {
    throw new AxiError("No refresh token stored", "AUTH", [
      "run `canva-axi auth login` to reconnect your Canva account",
    ]);
  }
  const { ok, status, body } = await postForm(metadata.token_endpoint, {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    ...(tokens.client_id ? { client_id: tokens.client_id } : {}),
  });
  if (!ok) {
    throw tokenError(String(body.error_description ?? body.error ?? "unknown error"), status);
  }
  const fresh = normalizeTokenSet(body, tokens);
  updateConfig((current) => ({ ...current, tokens: fresh }));
  return fresh;
}

/** Best-effort revocation; never throws. */
export async function revokeAccessToken(
  metadata: AuthorizationServerMetadata,
  token: string,
): Promise<boolean> {
  if (!metadata.revocation_endpoint) return false;
  try {
    const response = await fetch(metadata.revocation_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
