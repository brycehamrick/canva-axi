import { AxiError } from "axi-sdk-js";
import {
  installSessionStartHooks,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
} from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";

/**
 * Ambient-context setup (AXI principle 7). Hooks are installed only from
 * this explicit user-invoked command; ordinary commands never touch agent
 * configuration.
 */

const HOOK_OPTIONS = {
  marker: "canva-axi",
  binaryNames: ["canva-axi"],
};

const hooksSpec: CommandArgsSpec = {
  command: "setup hooks",
  flags: [
    { name: "project", type: "boolean", description: "install into the current repository instead of user config" },
    { name: "remove", type: "boolean", description: "uninstall the managed hooks instead of installing" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const statusSpec: CommandArgsSpec = {
  command: "setup status",
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

export const setupHelp = [
  renderCommandHelp({
    spec: hooksSpec,
    summary: "Install (or remove) canva-axi session-start hooks for Claude Code, Codex, and OpenCode",
    examples: ["canva-axi setup hooks", "canva-axi setup hooks --project", "canva-axi setup hooks --remove"],
  }),
  renderCommandHelp({
    spec: statusSpec,
    summary: "Report where canva-axi session hooks are installed, without writing",
    examples: ["canva-axi setup status"],
  }),
].join("\n\n");

export async function setupCommand(args: string[]): Promise<CommandOutput> {
  const subcommand = args[0];
  if (subcommand === "hooks") {
    const parsed = parseCommandArgs(args.slice(1), hooksSpec);
    const scope = parsed.booleans.project ? "project" : "user";
    if (parsed.booleans.remove) {
      uninstallSessionStartHooks({ ...HOOK_OPTIONS, scope });
      return emit(
        {
          setup: { hooks: "removed", scope },
          help: ["run `canva-axi setup hooks` to install them again"],
        },
        jsonWanted(parsed),
      );
    }
    installSessionStartHooks({ ...HOOK_OPTIONS, scope });
    const status = sessionStartHookStatus({ ...HOOK_OPTIONS, scope });
    return emit(
      {
        setup: {
          hooks: "installed or already up to date",
          scope,
          claude: { installed: status.claude.installed, path: status.claude.path },
          codex: { installed: status.codex.installed, path: status.codex.path },
          opencode: { installed: status.opencode.installed, path: status.opencode.path },
        },
        help: [
          "new sessions in supported agents now start with your Canva state visible",
          "run `canva-axi setup hooks --remove` to uninstall",
        ],
      },
      jsonWanted(parsed),
    );
  }
  if (subcommand === "status") {
    const parsed = parseCommandArgs(args.slice(1), statusSpec);
    const status = sessionStartHookStatus(HOOK_OPTIONS);
    return emit(
      {
        setup: {
          marker: status.marker,
          scope: status.scope,
          claude: { installed: status.claude.installed, path: status.claude.path },
          codex: { installed: status.codex.installed, path: status.codex.path },
          opencode: { installed: status.opencode.installed, path: status.opencode.path },
        },
      },
      jsonWanted(parsed),
    );
  }
  throw new AxiError(
    subcommand ? `unknown setup subcommand '${subcommand}'` : "setup requires a subcommand",
    "VALIDATION_ERROR",
    ["valid subcommands: hooks, status", "run `canva-axi setup hooks` to install session-start context"],
  );
}
