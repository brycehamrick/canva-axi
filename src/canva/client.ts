import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AxiError } from "axi-sdk-js";
import { VERSION } from "../version.js";
import { envAccessToken, readConfig, redact } from "./config.js";
import {
  DEFAULT_SERVER,
  MCP_PATH,
  fetchAuthorizationServerMetadata,
  refreshAccessToken,
} from "./oauth.js";

/**
 * Headless Canva MCP client.
 *
 * Wraps every tool the remote Canva MCP server exposes behind typed
 * functions with structured error mapping. Token resolution order:
 * CANVA_ACCESS_TOKEN env var, then stored OAuth tokens (refreshed silently
 * when within 60s of expiry). On a 401 with a stored refresh token the call
 * is retried once after a refresh.
 *
 * Timeout classes:
 * - Fast reads (search/get/list): 60s
 * - Server-wrapped jobs (the server polls internally up to ~1 min): 180s
 * - Client-poll jobs (create-design, separate-image-layers): separate
 *   start/poll calls so wait_seconds from polling_policy is honored
 */

export const DEFAULT_SERVER_URL = DEFAULT_SERVER;
export const DEFAULT_LIMIT = 10;
export const MAX_LIST_LIMIT = 100;

const FAST_TIMEOUT_MS = 60_000;
const JOB_TIMEOUT_MS = 180_000;
const POLL_TIMEOUT_MS = 60_000;

export type ToolName = string;

/** Injectable raw tool caller so tests can fake the MCP server. */
export type RawToolCaller = (
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
) => Promise<unknown>;

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface CanvaApi {
  /** Raw tool invocation with envelope unwrapping and error mapping. */
  call(tool: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  /** List the server's tools with their live input schemas (JSON-RPC tools/list). */
  listTools(): Promise<ToolInfo[]>;
  close(): Promise<void>;
  server(): string;
}

export function notLoggedInError(): AxiError {
  return new AxiError("Not logged in to Canva", "AUTH", [
    "run `canva-axi auth login` to connect your Canva account (one-time browser approval)",
    "or export CANVA_ACCESS_TOKEN=<token> for headless use",
  ]);
}

export function mcpServerUrl(server = DEFAULT_SERVER): URL {
  return new URL(MCP_PATH, httpsServer(server));
}

function httpsServer(server: string): URL {
  const parsed = new URL(server);
  if (parsed.protocol !== "https:") {
    throw new AxiError("Canva MCP server URL must use HTTPS", "VALIDATION_ERROR", [
      `use the default server ${DEFAULT_SERVER}`,
    ]);
  }
  return parsed;
}

export async function resolveAccessToken(server = DEFAULT_SERVER): Promise<string> {
  const fromEnv = envAccessToken();
  if (fromEnv) return fromEnv;
  const tokens = readConfig().tokens;
  if (!tokens?.access_token) throw notLoggedInError();
  if (
    tokens.expires_at !== undefined &&
    tokens.refresh_token &&
    tokens.expires_at - Date.now() < 60_000
  ) {
    try {
      const metadata = await fetchAuthorizationServerMetadata(server);
      const fresh = await refreshAccessToken(metadata);
      return fresh.access_token;
    } catch {
      // Let the request go out with the aging token; the 401 retry below
      // surfaces a precise AUTH error if refresh genuinely failed.
      return tokens.access_token;
    }
  }
  return tokens.access_token;
}

function isUnauthorized(error: unknown): boolean {
  const message = String((error as Error | undefined)?.message ?? error);
  return /401|unauthor/i.test(message);
}

function isRateLimit(error: unknown): boolean {
  const message = String((error as Error | undefined)?.message ?? error);
  return /429|rate limit/i.test(message);
}

function isTimeout(error: unknown): boolean {
  const e = error as Error | undefined;
  return Boolean(
    e && (e.name === "TimeoutError" || e.name === "AbortError" || /timed? ?out/i.test(e.message ?? "")),
  );
}

interface McpSession {
  call(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  close(): Promise<void>;
}

async function realCallToolFactory(server: string): Promise<RawToolCaller> {
  const initialToken = await resolveAccessToken(server);

  const openSession = async (accessToken: string): Promise<McpSession> => {
    const transport = new StreamableHTTPClientTransport(mcpServerUrl(server), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    });
    const client = new Client({ name: "canva-axi", version: VERSION }, { capabilities: {} });
    await client.connect(transport);
    return {
      call: async (name, args, timeoutMs) =>
        client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }),
      close: () => transport.close().catch(() => Promise.resolve()),
    };
  };

  return async (name, args, timeoutMs) => {
    let accessToken = initialToken;
    for (let attempt = 0; attempt < 2; attempt++) {
      let session: McpSession | undefined;
      try {
        session = await openSession(accessToken);
        return await session.call(name, args, timeoutMs);
      } catch (error) {
        // Retry once on 401 when we own a refresh token; env tokens cannot
        // be refreshed locally, so they surface the AUTH error immediately.
        const canRetry =
          attempt === 0 &&
          isUnauthorized(error) &&
          !envAccessToken() &&
          Boolean(readConfig().tokens?.refresh_token);
        if (!canRetry) throw mapTransportError(error, name);
        try {
          const metadata = await fetchAuthorizationServerMetadata(server);
          accessToken = (await refreshAccessToken(metadata)).access_token;
        } catch (refreshError) {
          throw mapTransportError(refreshError, name);
        }
      } finally {
        await session?.close();
      }
    }
    throw new AxiError("Canva MCP retry loop exhausted", "UPSTREAM", ["retry the command"]);
  };
}

function mapTransportError(error: unknown, tool: string): AxiError {
  if (error instanceof AxiError) return error;
  if (isUnauthorized(error)) {
    return new AxiError(`Canva authentication failed or session expired (${tool})`, "AUTH", [
      "run `canva-axi auth login` to reconnect",
    ]);
  }
  if (isRateLimit(error)) {
    return new AxiError(`Canva rate limit hit on ${tool}`, "RATE_LIMIT", [
      "wait a moment and retry the same command",
      "per-tool rate limits: https://www.canva.dev/docs/apps/mcp/tools/",
    ]);
  }
  if (isTimeout(error)) {
    return new AxiError(
      `Canva MCP request timed out on ${tool} (server jobs can take up to a minute)`,
      "TIMEOUT",
      ["retry the command", "for create-design jobs, poll with `canva-axi design job <id>`"],
    );
  }
  const message = redact(String((error as Error | undefined)?.message ?? error), envAccessToken());
  return new AxiError(`Canva MCP request failed on ${tool}: ${message}`, "UPSTREAM", [
    "retry the same command; if it persists, see https://www.canva.dev/docs/apps/mcp/troubleshooting/",
  ]);
}

interface ContentEnvelope {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

function unwrapPayload(result: unknown, tool: string): Record<string, unknown> {
  if (!result || typeof result !== "object") {
    throw new AxiError(`Unexpected response shape from ${tool}`, "UPSTREAM", ["retry the command"]);
  }
  const envelope = result as ContentEnvelope;
  if (envelope.structuredContent && typeof envelope.structuredContent === "object") {
    return envelope.structuredContent as Record<string, unknown>;
  }
  const textBlocks = (envelope.content ?? []).filter(
    (item) => (item?.type ?? "text") === "text" && typeof item.text === "string",
  );
  if (textBlocks.length > 1) {
    // Multiple text blocks (get-assets returns one JSON block per requested
    // id): parse each and return them in order under `blocks`.
    const blocks: Record<string, unknown>[] = [];
    for (const item of textBlocks) {
      try {
        blocks.push(JSON.parse(item.text!) as Record<string, unknown>);
      } catch {
        blocks.push({ text: item.text });
      }
    }
    return { blocks };
  }
  const first = envelope.content?.find((item) => item?.type === "text") ?? envelope.content?.[0];
  if (typeof first?.text === "string") {
    // MCP protocol errors (e.g. -32602 invalid params) arrive as text
    // frames; surface them as structured errors instead of payload text.
    const mcpError = /^MCP error (-?\d+): (.*)$/s.exec(first.text.trim());
    if (mcpError) {
      throw toolError(mcpError[1]!, mcpError[2]!, tool);
    }
    try {
      return JSON.parse(first.text) as Record<string, unknown>;
    } catch {
      // A single non-JSON text payload (rare): return as text.
      return { text: first.text };
    }
  }
  return result as Record<string, unknown>;
}

interface ToolErrorShape {
  code?: string;
  message?: string;
}

function checkToolError(payload: Record<string, unknown>, tool: string): void {
  const errored = payload.isError === true || payload.error === true;
  if (!errored) {
    // Job-wrapped results report failure via job.status = "failed"
    const job = payload.job as { status?: string; error?: ToolErrorShape } | undefined;
    if (job && typeof job === "object" && job.status === "failed") {
      throw jobError(job.error, tool);
    }
    // create-design / separate-image-layers polls report failure/failureType
    const failure = payload.failure as ToolErrorShape | undefined;
    if (failure && typeof failure === "object") {
      throw new AxiError(
        `Canva job failed: ${failure.message ?? "unknown failure"}`,
        "UPSTREAM",
        ["adjust the input and retry", "run the start command again for a fresh job"],
      );
    }
    return;
  }
  const error = (payload.error ?? payload) as ToolErrorShape;
  const message = String(error?.message ?? payload.message ?? "unknown Canva error");
  const code = String(error?.code ?? "");
  throw toolError(code, message, tool);
}

function jobError(error: ToolErrorShape | undefined, tool: string): AxiError {
  const message = String(error?.message ?? "job failed");
  const code = String(error?.code ?? "");
  return toolError(code, message, tool);
}

function toolError(code: string, message: string, tool: string): AxiError {
  // MCP input-validation errors: extract the human summary and point at the
  // live schema so an agent self-corrects in one turn.
  if (code === "-32602" || /Input validation error/i.test(message)) {
    const first = message.split("\n").find((line) => line.trim().length > 0) ?? message;
    return new AxiError(`Canva rejected the arguments for ${tool}: ${first.slice(0, 300)}`, "VALIDATION_ERROR", [
      "check the live input schema: canva-axi tools --schema <tool-name>",
    ]);
  }
  if (/auth|token|session|scope/i.test(`${code} ${message}`) && /missing scopes/i.test(message)) {
    return new AxiError(`Canva rejected the request: ${message}`, "AUTH", [
      "run `canva-axi auth login` again and approve the additional scopes",
    ]);
  }
  if (/401|unauthor|invalid_token|expired/i.test(`${code} ${message}`)) {
    return new AxiError(`Canva rejected the request: ${message}`, "AUTH", [
      "run `canva-axi auth login` to reconnect",
    ]);
  }
  if (/429|rate.?limit|too many requests/i.test(`${code} ${message}`)) {
    return new AxiError(`Canva rate limit hit on ${tool}: ${message}`, "RATE_LIMIT", [
      "wait a moment and retry the same command",
      "per-tool rate limits: https://www.canva.dev/docs/apps/mcp/tools/",
    ]);
  }
  if (/quota_exceeded|quota/i.test(`${code} ${message}`)) {
    return new AxiError(`Canva quota exceeded: ${message}`, "RATE_LIMIT", [
      "show the upgrade link in the message to the user, or wait for the quota window to reset",
    ]);
  }
  if (/license_required|premium/i.test(`${code} ${message}`)) {
    return new AxiError(`Canva premium content blocked: ${message}`, "PAYMENT_REQUIRED", [
      "remove premium elements from the design, or export a page without them",
      "Canva Pro unlocks premium export: https://www.canva.com/pricing",
    ]);
  }
  if (/not_found|404/i.test(`${code} ${message}`)) {
    return new AxiError(`Canva reports not found: ${message}`, "NOT_FOUND", [
      "check the id; run `canva-axi design search <query>` to find the right one",
    ]);
  }
  if (/plan|pro/i.test(code) && /upgrade|plan/i.test(message)) {
    return new AxiError(`Canva plan required: ${message}`, "PAYMENT_REQUIRED", [
      "this capability needs Canva Pro or above",
    ]);
  }
  if (/validation|invalid|400/i.test(`${code} ${message}`)) {
    return new AxiError(`Canva rejected the input: ${message}`, "VALIDATION_ERROR", [
      `run \`canva-axi ${tool.replace(/-/g, " ")} --help\` for usage`,
    ]);
  }
  return new AxiError(`Canva API error on ${tool}${code ? ` (${code})` : ""}: ${message}`, "UPSTREAM", [
    "adjust the input and retry, or report at https://github.com/brycehamrick/canva-axi/issues",
  ]);
}

async function realListTools(server: string): Promise<ToolInfo[]> {
  const accessToken = await resolveAccessToken(server);
  const transport = new StreamableHTTPClientTransport(mcpServerUrl(server), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: "canva-axi", version: VERSION }, { capabilities: {} });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    return (response.tools ?? []).map((tool) => ({
      name: String(tool.name ?? ""),
      description: String(tool.description ?? ""),
      inputSchema: tool.inputSchema ?? {},
    }));
  } catch (error) {
    throw mapTransportError(error, "tools/list");
  } finally {
    await transport.close().catch(() => Promise.resolve());
  }
}

export interface CreateApiOptions {
  server?: string;
  callTool?: RawToolCaller;
  /** Injectable tools/list result for tests. */
  listToolsResult?: ToolInfo[];
}

export function createCanvaApi(options: CreateApiOptions = {}): CanvaApi {
  const server = options.server ?? DEFAULT_SERVER;
  let caller: RawToolCaller | undefined = options.callTool;

  const ensureCaller = async (): Promise<RawToolCaller> => {
    if (!caller) caller = await realCallToolFactory(server);
    return caller;
  };

  return {
    server: () => server,
    async call(tool, args = {}, timeoutMs = FAST_TIMEOUT_MS) {
      const active = await ensureCaller();
      const payload = unwrapPayload(await active(tool, args, timeoutMs), tool);
      checkToolError(payload, tool);
      return payload;
    },
    async listTools() {
      if (options.listToolsResult) return options.listToolsResult;
      return realListTools(server);
    },
    async close() {
      // Sessions are opened per call in realCallToolFactory and closed in
      // its finally; nothing persistent to close.
    },
  };
}

export const TIMEOUTS = {
  fast: FAST_TIMEOUT_MS,
  job: JOB_TIMEOUT_MS,
  poll: POLL_TIMEOUT_MS,
} as const;
