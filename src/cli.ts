import { AxiError, runAxiCli } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import { VERSION } from "./version.js";
import { DESCRIPTION, topLevelHelpText } from "./skill.js";
import { createCanvaApi } from "./canva/client.js";
import { homeCommand } from "./commands/home.js";
import { loginCommand, statusCommand, logoutCommand, authHelp } from "./commands/auth.js";
import { designCommand, designHelp } from "./commands/design.js";
import { designopsCommand, designopsHelp } from "./commands/designops.js";
import { generateCommand, generateHelp } from "./commands/generate.js";
import { editCommand, editHelp } from "./commands/edit.js";
import { imageCommand, imageHelp } from "./commands/image.js";
import { folderCommand, folderHelp } from "./commands/folder.js";
import { commentCommand, commentHelp } from "./commands/comment.js";
import { exportCommand, exportHelp } from "./commands/export.js";
import {
  templateCommand,
  autofillCommand,
  autofillFieldsCommand,
  shortlinkCommand,
  templateHelp,
} from "./commands/template.js";
import { publishCommand, publishHelp } from "./commands/publish.js";
import { helpCommand, helpCommandHelp } from "./commands/help.js";
import { toolsCommand, toolsHelp } from "./commands/tools.js";
import { setupCommand, setupHelp } from "./commands/setup.js";

/** Per-command context: injectable API factory keeps handlers testable. */
export interface CommandContext {
  createApi: typeof createCanvaApi;
}

function isDesignOp(sub: string | undefined): boolean {
  return sub === "copy" || sub === "resize" || sub === "merge" || sub === "import";
}

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: topLevelHelpText(),
    getCommandHelp: (command) => COMMAND_HELP[command] ?? null,
    // A missing --confirm is a usage error (AXI principle 6: exit 2, same
    // as a missing required flag) even though it carries a change preview.
    formatError: (error) => {
      if (error instanceof AxiError) {
        const block: Record<string, unknown> = { error: error.message, code: error.code };
        if (error.suggestions.length > 0) block.help = error.suggestions;
        const exitCode =
          error.code === "VALIDATION_ERROR" || error.code === "CONFIRM_REQUIRED" ? 2 : 1;
        return { output: `${encode(block)}\n`, exitCode };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { output: `${encode({ error: message, code: "UNKNOWN" })}\n`, exitCode: 1 };
    },
    home: async () => homeCommand(),
    resolveContext: (input) => ({ createApi: createCanvaApi }),
    commands: {
      auth: async (args) => {
        const sub = args[0];
        if (sub === "login") return loginCommand(args.slice(1));
        if (sub === "status") return statusCommand(args.slice(1));
        if (sub === "logout") return logoutCommand(args.slice(1));
        if (sub === undefined) {
          throw new AxiError("missing subcommand for 'auth'", "VALIDATION_ERROR", [
            "valid subcommands: login | status | logout",
            "Run `canva-axi auth --help` for details",
          ]);
        }
        throw new AxiError(`unknown auth subcommand '${sub}'`, "VALIDATION_ERROR", [
          "valid subcommands: login | status | logout",
          "Run `canva-axi auth --help` for details",
        ]);
      },
      design: async (args, ctx) => {
        if (isDesignOp(args[0])) return designopsCommand(args, ctx!);
        return designCommand(args, ctx!);
      },
      generate: (args, ctx) => generateCommand(args, ctx!),
      edit: (args, ctx) => editCommand(args, ctx!),
      image: (args, ctx) => imageCommand(args, ctx!),
      folder: (args, ctx) => folderCommand(args, ctx!),
      comment: (args, ctx) => commentCommand(args, ctx!),
      export: (args, ctx) => exportCommand(args, ctx!),
      template: async (args, ctx) => {
        const sub = args[0];
        if (sub === "draft" || sub === "publish") {
          return publishCommand(args, ctx!);
        }
        return templateCommand(args, ctx!);
      },
      autofill: async (args, ctx) => {
        if (args[0] === "fields") return autofillFieldsCommand(args.slice(1), ctx!);
        return autofillCommand(args, ctx!);
      },
      shortlink: (args, ctx) => shortlinkCommand(args, ctx!),
      help: (args, ctx) => helpCommand(args, ctx!),
      tools: (args, ctx) => toolsCommand(args, ctx!.createApi()),
      setup: async (args) => setupCommand(args),
    },
  });
}

const COMMAND_HELP: Record<string, string> = {
  auth: authHelp,
  design: [designHelp, designopsHelp].join("\n\n"),
  generate: generateHelp,
  edit: editHelp,
  image: imageHelp,
  folder: folderHelp,
  comment: commentHelp,
  export: exportHelp,
  template: [templateHelp, publishHelp].join("\n\n"),
  autofill: [
    // autofill help is defined inline in template.ts specs; reuse via render
    renderAutofillHelp(),
  ].join("\n\n"),
  shortlink: renderShortlinkHelp(),
  help: helpCommandHelp,
  tools: toolsHelp,
  setup: setupHelp,
};

function renderAutofillHelp(): string {
  return [
    "command: canva-axi autofill",
    "summary: Fill a template's or design's data fields (check template dataset first)",
    "flags[7]{flag,default,description}:",
    " --template,,brand template id (BTM…)",
    " --design,,existing design id (D…)",
    " --data,,JSON object of field → value",
    " --title,,title for the produced design",
    " --update-in-place,,refill the source design (irreversible)",
    " --confirm,,required",
    " --json,,emit JSON instead of TOON",
    "examples[1]:",
    ' canva-axi autofill --template BTM123 --data \'{"event_title":"Spring Launch"}\' --confirm',
  ].join("\n");
}

function renderShortlinkHelp(): string {
  return [
    "command: canva-axi shortlink <link>",
    "summary: Expand a canva.link shortlink to the full design URL",
    "flags[2]{flag,description}:",
    " --json,emit JSON instead of TOON",
    " --help,show this help",
    "examples[2]:",
    " canva-axi shortlink https://canva.link/abc123",
    " canva-axi shortlink abc123",
  ].join("\n");
}
