import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, normalizeDesignId, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { designDetailView, serverJobView } from "../render.js";

/**
 * Brand Template publishing flow (Pro + brand roles): draft from a
 * template, edit the draft, publish. Also `template draft` on an existing
 * draft. All publish operations mutate shared brand content → --confirm.
 */

const draftSpec: CommandArgsSpec = {
  command: "template draft",
  args: [{ name: "template-id", required: true, description: "brand template id (BTM…)" }],
  flags: [
    { name: "confirm", type: "boolean", description: "required: creates or fetches an editable draft" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const publishSpec: CommandArgsSpec = {
  command: "template publish",
  args: [{ name: "ref", required: true, description: "draft design id (D…) to publish as the template" }],
  flags: [
    { name: "confirm", type: "boolean", description: "required: replaces the Brand Template's content" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

export const publishHelp = [
  renderCommandHelp({
    spec: draftSpec,
    summary: "Get the editable draft design for a Brand Template (returns the existing draft if one exists)",
    examples: ["canva-axi template draft BTM123 --confirm"],
  }),
  renderCommandHelp({
    spec: publishSpec,
    summary: "Publish a draft design back as the Brand Template (replaces its content)",
    examples: ["canva-axi template publish DAFtmABcN3s --confirm"],
  }),
].join("\n\n");

export async function publishCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const sub = args[0];
  if (sub === "draft") return draftSub(args.slice(1), deps);
  if (sub === "publish") return publishSub(args.slice(1), deps);
  throw new AxiError(`unknown template subcommand '${sub}'`, "VALIDATION_ERROR", [
    "valid subcommands: kits | search | dataset | draft | publish | create",
    "Run `canva-axi template --help` for details",
  ]);
}

async function draftSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, draftSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("template draft creates an editable draft and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi template draft <id> --confirm",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "create-brand-template-draft",
    { brand_template_id: parsed.positionals[0]! },
    TIMEOUTS.fast,
  );
  const design = (payload.design ?? {}) as Record<string, unknown>;
  const view = designDetailView(design);
  view.help = [
    `edit the draft: canva-axi edit start ${String(design.id ?? "<id>")}`,
    "then publish it back: canva-axi template publish <draft-id> --confirm",
  ];
  return emit(view, jsonWanted(parsed));
}

async function publishSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, publishSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError(
      "template publish replaces the Brand Template's content and requires --confirm",
      "VALIDATION_ERROR",
      [
        "re-run with --confirm: canva-axi template publish <draft-id> --confirm",
        "publishing requires a Team admin / Brand designer role",
      ],
    );
  }
  const api = deps.createApi();
  const payload = await api.call(
    "publish-brand-template",
    { design_id: normalizeDesignId(parsed.positionals[0]!) },
    TIMEOUTS.job,
  );
  const template = (payload.brand_template ?? {}) as Record<string, unknown>;
  return emit(
    {
      brand_template: {
        id: String(template.id ?? ""),
        title: String(template.title ?? ""),
        ...(template.create_url ? { create_url: String(template.create_url) } : {}),
      },
      help: ["start a design from it: canva-axi template create <id> --confirm"],
    },
    jsonWanted(parsed),
  );
}
