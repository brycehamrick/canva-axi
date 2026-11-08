import { spawn } from "node:child_process";
import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { deleteConfig, readConfig, tokenSource, ENV_TOKEN_VAR } from "../canva/config.js";
import {
  fetchAuthorizationServerMetadata,
  registerDynamicClient,
  createPkcePair,
  randomState,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  revokeAccessToken,
} from "../canva/oauth.js";
import { startLoopbackListener } from "../canva/loopback.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";

/**
 * Credential lifecycle. `auth login` is the only command that ever waits on
 * a human; every other command runs headlessly against stored or env tokens.
 */

const loginSpec: CommandArgsSpec = {
  command: "auth login",
  flags: [
    { name: "timeout", type: "string", default: "300", description: "seconds to wait for browser approval" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const statusSpec: CommandArgsSpec = {
  command: "auth status",
  flags: [
    { name: "probe", type: "boolean", description: "verify the token against the Canva MCP server" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const logoutSpec: CommandArgsSpec = {
  command: "auth logout",
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

export const authHelp = [
  renderCommandHelp({
    spec: loginSpec,
    summary: "Connect your Canva account with a one-time browser approval (all other commands stay headless)",
    examples: ["canva-axi auth login", "canva-axi auth login --timeout 120"],
  }),
  renderCommandHelp({
    spec: statusSpec,
    summary: "Show whether canva-axi is connected and where the token comes from",
    examples: ["canva-axi auth status", "canva-axi auth status --probe"],
  }),
  renderCommandHelp({
    spec: logoutSpec,
    summary: "Revoke stored tokens and remove the local credential file",
    examples: ["canva-axi auth logout"],
  }),
].join("\n\n");

function tryOpenBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(command, [url], { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // Opening a browser is best-effort; the URL is always printed too.
  }
}

export async function loginCommand(args: string[]): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, loginSpec);
  const timeoutSeconds = Number(parsed.strings.timeout ?? "300");
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new AxiError(`invalid --timeout value '${parsed.strings.timeout}'`, "VALIDATION_ERROR", [
      "use a positive number of seconds, e.g. --timeout 120",
    ]);
  }

  const metadata = await fetchAuthorizationServerMetadata();
  const listener = await startLoopbackListener();
  let clientId: string;
  try {
    clientId = await registerDynamicClient(metadata, listener.redirectUri);
    const { verifier, challenge } = createPkcePair();
    const state = randomState();
    const authUrl = buildAuthorizeUrl(metadata, {
      clientId,
      redirectUri: listener.redirectUri,
      challenge,
      state,
    });
    process.stderr.write(`canva-axi: opening ${authUrl}\n`);
    tryOpenBrowser(authUrl);
    const code = await listener.waitForCode({ state, timeoutMs: timeoutSeconds * 1000 });
    await exchangeAuthorizationCode(metadata, {
      clientId,
      redirectUri: listener.redirectUri,
      code,
      verifier,
    });
  } finally {
    listener.close();
  }

  return emit(
    {
      auth: {
        status: "connected",
        scopes_note: "all Canva MCP scopes were requested; Canva grants what the account's plan supports",
      },
      help: [
        "verify with a live probe: canva-axi auth status --probe",
        "see your recent designs: canva-axi design search",
      ],
    },
    jsonWanted(parsed),
  );
}

export async function statusCommand(args: string[]): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, statusSpec);
  const source = tokenSource();
  const tokens = readConfig().tokens;
  const out: Record<string, unknown> = {
    auth: {
      status: source === "none" ? "not connected" : "connected",
      token_source: source,
      ...(tokens?.expires_at
        ? {
            expires: new Date(tokens.expires_at).toISOString(),
            refreshable: Boolean(tokens.refresh_token),
          }
        : {}),
    },
  };
  const authBlock = out.auth as Record<string, unknown>;
  if (parsed.booleans.probe && source !== "none") {
    try {
      await createCanvaApi().call("search-designs", { query: "", limit: 1 }, TIMEOUTS.fast);
      authBlock.probe = "ok — token works against https://mcp.canva.com/mcp";
    } catch (error) {
      authBlock.probe = `failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  out.help =
    source === "none"
      ? ["run `canva-axi auth login` to connect (one-time browser approval)"]
      : ["token healthy; run `canva-axi` for the dashboard view"];
  return emit(out, jsonWanted(parsed));
}

export async function logoutCommand(args: string[]): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, logoutSpec);
  const tokens = readConfig().tokens;
  let revoked = false;
  if (tokens?.access_token) {
    try {
      const metadata = await fetchAuthorizationServerMetadata();
      revoked = await revokeAccessToken(metadata, tokens.access_token);
    } catch {
      revoked = false;
    }
  }
  const removed = deleteConfig();
  return emit(
    {
      auth: {
        status: "logged out",
        token_file_removed: removed,
        ...(revoked ? { server_revoked: true } : {}),
      },
      help: [
        revoked
          ? "the stored token was revoked server-side and deleted locally"
          : "the local token file was removed (best-effort server revocation didn't complete)",
        "reconnect any time: canva-axi auth login",
      ],
    },
    jsonWanted(parsed),
  );
}
