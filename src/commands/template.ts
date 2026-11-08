import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS, DEFAULT_LIMIT } from "../canva/client.js";
import { emit, jsonWanted, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { brandKitsView, templatesView, datasetView, serverJobView, designDetailView } from "../render.js";
import { clampLimit } from "./design.js";

/**
 * Brand Templates, Brand Kits, autofill, and shortlinks. Pro-plan tools
 * return empty results (not errors) on Free plans — surfaced as definitive
 * empty states.
 */

const kitsSpec: CommandArgsSpec = {
  command: "template kits",
  flags: [
    { name: "limit", type: "string", default: String(DEFAULT_LIMIT), description: "max results (1-100)" },
    { name: "continuation", type: "string", description: "pagination token" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const searchSpec: CommandArgsSpec = {
  command: "template search",
  args: [{ name: "query", required: false, description: "match template titles (omit to browse all)" }],
  flags: [
    { name: "brand-kit", type: "string", description: "restrict to one brand kit's templates" },
    { name: "limit", type: "string", default: String(DEFAULT_LIMIT), description: "max results (1-100)" },
    { name: "continuation", type: "string", description: "pagination token" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const datasetSpec: CommandArgsSpec = {
  command: "template dataset",
  args: [{ name: "template-id", required: true, description: "brand template id (BTM…)" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

const designDatasetSpec: CommandArgsSpec = {
  command: "autofill fields",
  args: [{ name: "ref", required: true, description: "design id (D…) or share URL" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const createSpec: CommandArgsSpec = {
  command: "template create",
  args: [{ name: "template-id", required: true, description: "brand template id (BTM…)" }],
  flags: [
    { name: "pages", type: "string", description: "comma-separated 1-based pages to include (default all)" },
    { name: "confirm", type: "boolean", description: "required: creates a new design in your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const autofillSpec: CommandArgsSpec = {
  command: "autofill",
  flags: [
    { name: "template", type: "string", description: "brand template id (BTM…)" },
    { name: "design", type: "string", description: "existing design id (D…)" },
    { name: "data", type: "string", description: "JSON object of field → value" },
    { name: "title", type: "string", description: "title for the produced design" },
    { name: "update-in-place", type: "boolean", description: "refill the source design instead of creating a copy (irreversible)" },
    { name: "confirm", type: "boolean", description: "required: creates or overwrites design content" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const shortlinkSpec: CommandArgsSpec = {
  command: "shortlink",
  args: [{ name: "shortlink", required: true, description: "canva.link shortlink or its path segment" },
  ],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

export const templateHelp = [
  renderCommandHelp({
    spec: kitsSpec,
    summary: "List your Brand Kits (Pro)",
    examples: ["canva-axi template kits"],
  }),
  renderCommandHelp({
    spec: searchSpec,
    summary: "Find Brand Templates by title or brand kit (Pro)",
    examples: ["canva-axi template search pitch", "canva-axi template search --brand-kit BK_EXAMPLE"],
  }),
  renderCommandHelp({
    spec: datasetSpec,
    summary: "List a Brand Template's autofill fields and types",
    examples: ["canva-axi template dataset BTM123"],
  }),
  renderCommandHelp({
    spec: createSpec,
    summary: "Create a new editable design from a Brand Template (Pro)",
    examples: ["canva-axi template create BTM123 --confirm", "canva-axi template create BTM123 --pages 1,2,3 --confirm"],
  }),
  renderCommandHelp({
    spec: autofillSpec,
    summary: "Fill a template's or design's data fields (check template dataset first)",
    examples: ['canva-axi autofill --template BTM123 --data \'{"event_title":"Spring Launch"}\' --confirm'],
  }),
  renderCommandHelp({
    spec: shortlinkSpec,
    summary: "Expand a canva.link shortlink to the full design URL",
    examples: ["canva-axi shortlink https://canva.link/abc123", "canva-axi shortlink abc123"],
  }),
].join("\n\n");

export async function templateCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const sub = args[0];
  switch (sub) {
    case "kits":
      return kitsSub(args.slice(1), deps);
    case "search":
      return searchSub(args.slice(1), deps);
    case "dataset":
      return datasetSub(args.slice(1), deps);
    case "create":
      return createSub(args.slice(1), deps);
    default:
      throw new AxiError(`unknown template subcommand '${sub}'`, "VALIDATION_ERROR", [
        "valid subcommands: kits | search | dataset | create",
        "Run `canva-axi template --help` for details",
      ]);
  }
}

export async function autofillFieldsCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, designDatasetSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "get-design-dataset",
    { design_id: parsed.positionals[0]! },
    TIMEOUTS.fast,
  );
  return emit(datasetView(payload, "design", parsed.positionals[0]!), jsonWanted(parsed));
}

export async function autofillCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, autofillSpec);
  const hasTemplate = Boolean(parsed.strings.template);
  const hasDesign = Boolean(parsed.strings.design);
  if (hasTemplate === hasDesign) {
    throw new AxiError("autofill needs exactly one of --template or --design", "VALIDATION_ERROR", [
      "--template <BTM id> for a Brand Template",
      "--design <D id> for an existing design",
    ]);
  }
  if (!parsed.strings.data) {
    throw new AxiError("autofill requires --data (JSON object of field → value)", "VALIDATION_ERROR", [
      'example: --data \'{"event_title":"Spring Launch"}\'',
      "check field names first: canva-axi template dataset <id>",
    ]);
  }
  let data: unknown;
  try {
    data = JSON.parse(parsed.strings.data);
  } catch {
    throw new AxiError("--data must be valid JSON", "VALIDATION_ERROR", [
      'example: --data \'{"event_title":"Spring Launch"}\'',
    ]);
  }
  if (parsed.booleans["update-in-place"] && parsed.booleans.confirm !== true) {
    throw new AxiError(
      "autofill --update-in-place overwrites the existing design irreversibly and requires --confirm",
      "VALIDATION_ERROR",
      [
        "re-run with --confirm",
        "omit --update-in-place to produce a new design instead (still needs --confirm)",
      ],
    );
  }
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("autofill creates or overwrites design content and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm after checking the dataset fields",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "autofill-design",
    {
      ...(hasTemplate ? { brand_template_id: parsed.strings.template } : { design_id: parsed.strings.design }),
      data,
      ...(parsed.strings.title ? { title: parsed.strings.title } : {}),
      ...(parsed.booleans["update-in-place"] ? { update_in_place: true } : {}),
    },
    TIMEOUTS.job,
  );
  const view = serverJobView(payload, ["check the result: canva-axi design get <id>"]);
  if (parsed.booleans["update-in-place"]) {
    view.help = ["the source design was refilled in place — this can't be undone"];
  }
  return emit(view, jsonWanted(parsed));
}

export async function shortlinkCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, shortlinkSpec);
  const raw = parsed.positionals[0]!;
  const shortlinkId = raw.includes("canva.link") ? (raw.split("/").pop() ?? raw) : raw;
  const api = deps.createApi();
  const payload = await api.call("resolve-shortlink", { shortlink_id: shortlinkId }, TIMEOUTS.fast);
  const out: Record<string, unknown> = {
    target_url: String(payload.target_url ?? ""),
  };
  out.help = ["open it: canva-axi design get <target_url> (share URLs are accepted directly)"];
  return emit(out, jsonWanted(parsed));
}

async function kitsSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, kitsSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "list-brand-kits",
    {
      limit: clampLimit(parsed.strings.limit, "template kits"),
      ...(parsed.strings.continuation ? { continuation: parsed.strings.continuation } : {}),
    },
    TIMEOUTS.fast,
  );
  return emit(brandKitsView(payload), jsonWanted(parsed));
}

async function searchSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, searchSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "search-brand-templates",
    {
      ...(parsed.positionals[0] ? { query: parsed.positionals[0] } : {}),
      ...(parsed.strings["brand-kit"] ? { brand_kit_id: parsed.strings["brand-kit"] } : {}),
      limit: clampLimit(parsed.strings.limit, "template search"),
      ...(parsed.strings.continuation ? { continuation: parsed.strings.continuation } : {}),
    },
    TIMEOUTS.fast,
  );
  return emit(templatesView(payload), jsonWanted(parsed));
}

async function datasetSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, datasetSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "get-brand-template-dataset",
    { template_id: parsed.positionals[0]! },
    TIMEOUTS.fast,
  );
  return emit(datasetView(payload, "template", parsed.positionals[0]!), jsonWanted(parsed));
}

async function createSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, createSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("template create makes a new design and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi template create <id> --confirm",
    ]);
  }
  let pages: number[] | undefined;
  if (parsed.strings.pages) {
    pages = parsed.strings.pages.split(",").map((piece) => Number(piece.trim()));
    if (pages.some((page) => !Number.isInteger(page) || page < 1)) {
      throw new AxiError(`invalid --pages '${parsed.strings.pages}'`, "VALIDATION_ERROR", [
        "use comma-separated 1-based page numbers",
      ]);
    }
  }
  const api = deps.createApi();
  const payload = await api.call(
    "create-design-from-brand-template",
    {
      brand_template_id: parsed.positionals[0]!,
      ...(pages ? { page_numbers: pages } : {}),
    },
    TIMEOUTS.fast,
  );
  const design = (payload.design ?? {}) as Record<string, unknown>;
  const view = designDetailView(design);
  view.help = ["fill its data fields: canva-axi template dataset <id>, then autofill", "edit it: canva-axi edit start <id>"];
  return emit(view, jsonWanted(parsed));
}
