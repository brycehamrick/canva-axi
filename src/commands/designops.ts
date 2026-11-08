import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, normalizeDesignId, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { serverJobView, designDetailView, mergeView } from "../render.js";

/**
 * Design-level operations: copy, resize, merge (page-level restructuring),
 * and import from URL. All mutate the account → --confirm gated; merge's
 * delete_pages is permanent and flagged in help text.
 */

const copySpec: CommandArgsSpec = {
  command: "design copy",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [
    { name: "pages", type: "string", description: "comma-separated 1-based page numbers to copy (default all)" },
    { name: "confirm", type: "boolean", description: "required: creates a new design in your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const resizeSpec: CommandArgsSpec = {
  command: "design resize",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [
    { name: "preset", type: "string", values: ["presentation", "whiteboard"], description: "preset size" },
    { name: "width", type: "string", description: "custom width in pixels (with --height)" },
    { name: "height", type: "string", description: "custom height in pixels (with --width)" },
    { name: "confirm", type: "boolean", description: "required: creates a resized copy (Pro)" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const mergeSpec: CommandArgsSpec = {
  command: "design merge",
  args: [{ name: "ref", required: true, description: "destination design id (D…)" }],
  flags: [
    { name: "op", type: "string", values: ["insert_pages", "move_pages", "delete_pages"], required: true, description: "merge operation" } as never,
    { name: "from-design", type: "string", description: "source design id for insert_pages" },
    { name: "pages", type: "string", description: "comma-separated page numbers (insert/move: also --to)" },
    { name: "to", type: "string", description: "target position for move_pages" },
    { name: "new-title", type: "string", description: "title when creating a new design instead of modifying" },
    { name: "confirm", type: "boolean", description: "required: restructures pages; delete_pages is permanent" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const importSpec: CommandArgsSpec = {
  command: "design import",
  args: [
    { name: "url", required: true, description: "public HTTPS url of the file to import" },
    { name: "name", required: true, description: "name for the new design" },
  ],
  flags: [
    { name: "type", type: "string", description: "intended design type (see tool schema)" },
    { name: "confirm", type: "boolean", description: "required: creates a new design in your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

export const designopsHelp = [
  renderCommandHelp({
    spec: copySpec,
    summary: "Duplicate a design (optionally only some pages) — the source is unchanged",
    examples: ["canva-axi design copy DAFtmABcN3s --confirm", "canva-axi design copy DAFtmABcN3s --pages 1,3,5 --confirm"],
  }),
  renderCommandHelp({
    spec: resizeSpec,
    summary: "Create a resized copy of a design (Canva Pro; Free plans have a limited trial)",
    examples: [
      "canva-axi design resize DAFtmABcN3s --preset presentation --confirm",
      "canva-axi design resize DAFtmABcN3s --width 1920 --height 1080 --confirm",
    ],
  }),
  renderCommandHelp({
    spec: mergeSpec,
    summary: "Insert/move/delete whole pages (one operation per call; delete is permanent)",
    examples: [
      "canva-axi design merge DAFtmABcN3s --op insert_pages --from-design DAGxxxx --pages 5,6 --confirm",
      "canva-axi design merge DAFtmABcN3s --op move_pages --pages 3 --to 1 --confirm",
      "canva-axi design merge DAFtmABcN3s --op delete_pages --pages 2 --confirm",
    ],
  }),
  renderCommandHelp({
    spec: importSpec,
    summary: "Turn a publicly hosted PDF/deck/document/web page into a new Canva design",
    examples: ['canva-axi design import https://example.com/report.pdf "Quarterly Report" --confirm'],
  }),
].join("\n\n");

export async function designopsCommand(
  args: string[],
  deps: { createApi: typeof createCanvaApi },
): Promise<CommandOutput> {
  // Dispatched from designCommand: "copy" | "resize" | "merge" | "import"
  const sub = args[0];
  switch (sub) {
    case "copy":
      return copySub(args.slice(1), deps);
    case "resize":
      return resizeSub(args.slice(1), deps);
    case "merge":
      return mergeSub(args.slice(1), deps);
    case "import":
      return importSub(args.slice(1), deps);
    default:
      throw new AxiError(`unknown design operation '${sub}'`, "VALIDATION_ERROR", [
        "valid operations: copy | resize | merge | import",
        "Run `canva-axi design --help` for details",
      ]);
  }
}

function parsePages(spec: string | undefined, command: string): number[] | undefined {
  if (!spec) return undefined;
  const pages = spec.split(",").map((piece) => Number(piece.trim()));
  if (pages.some((page) => !Number.isInteger(page) || page < 1)) {
    throw new AxiError(`invalid --pages '${spec}' for ${command}`, "VALIDATION_ERROR", [
      "use comma-separated 1-based page numbers, e.g. --pages 1,3,5",
    ]);
  }
  return pages;
}

async function copySub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, copySpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("design copy creates a new design and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi design copy <id> --confirm",
      "the source design is never modified by a copy",
    ]);
  }
  const api = deps.createApi();
  const pages = parsePages(parsed.strings.pages, "design copy");
  const payload = await api.call(
    "copy-design",
    {
      design_id: normalizeDesignId(parsed.positionals[0]!),
      ...(pages ? { page_numbers: pages } : {}),
    },
    TIMEOUTS.fast,
  );
  const design = (payload.design ?? {}) as Record<string, unknown>;
  const view = designDetailView(design);
  view.help = ["the copy is independent — edit it: canva-axi edit start <id>"];
  return emit(view, jsonWanted(parsed));
}

async function resizeSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, resizeSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("design resize creates a resized copy and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi design resize <id> --confirm",
    ]);
  }
  const hasPreset = Boolean(parsed.strings.preset);
  const hasDims =
    parsed.strings.width !== undefined &&
    parsed.strings.height !== undefined &&
    parsed.strings.width !== "" &&
    parsed.strings.height !== "";
  if (!hasPreset && !hasDims) {
    throw new AxiError("design resize needs either --preset or both --width and --height", "VALIDATION_ERROR", [
      "presets: presentation | whiteboard",
      "example: --width 1920 --height 1080",
    ]);
  }
  const api = deps.createApi();
  // Live schema: design_type is anyOf [{type:"preset",name} | {type:"custom",width,height}]
  const designType = hasPreset
    ? { type: "preset", name: parsed.strings.preset }
    : { type: "custom", width: Number(parsed.strings.width), height: Number(parsed.strings.height) };
  const payload = await api.call(
    "resize-design",
    { design_id: normalizeDesignId(parsed.positionals[0]!), design_type: designType },
    TIMEOUTS.job,
  );
  const view = serverJobView(payload, ["the original design is unchanged"]);
  return emit(view, jsonWanted(parsed));
}

async function mergeSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, mergeSpec);
  if (parsed.booleans.confirm !== true) {
    const op = parsed.strings.op ?? "<op>";
    throw new AxiError(
      `design merge ${op} restructures the design and requires --confirm`,
      "VALIDATION_ERROR",
      [
        "re-run with --confirm: canva-axi design merge <id> --op <op> ... --confirm",
        "delete_pages is permanent — confirm the exact pages with the user first",
      ],
    );
  }
  const op = parsed.strings.op!;
  const pages = parsePages(parsed.strings.pages, "design merge");
  const createNew = Boolean(parsed.strings["new-title"]);
  const designId = normalizeDesignId(parsed.positionals[0]!);
  let operation: Record<string, unknown>;
  switch (op) {
    case "insert_pages":
      if (!parsed.strings["from-design"]) {
        throw new AxiError("insert_pages requires --from-design <design-id>", "VALIDATION_ERROR", [
          "the pages come from another design",
        ]);
      }
      if (!pages) {
        throw new AxiError("insert_pages requires --pages 1,3", "VALIDATION_ERROR", [
          "comma-separated 1-based page numbers from the source design",
        ]);
      }
      operation = { type: "insert_pages", source_design_id: parsed.strings["from-design"], page_numbers: pages };
      break;
    case "move_pages":
      if (!pages) {
        throw new AxiError("move_pages requires --pages 3", "VALIDATION_ERROR", []);
      }
      if (parsed.strings.to === undefined) {
        throw new AxiError("move_pages requires --to <position>", "VALIDATION_ERROR", [
          "1-based target position",
        ]);
      }
      operation = { type: "move_pages", page_numbers: pages, to: Number(parsed.strings.to) };
      break;
    case "delete_pages":
      if (!pages) {
        throw new AxiError("delete_pages requires --pages 2", "VALIDATION_ERROR", [
          "deleting pages is permanent",
        ]);
      }
      operation = { type: "delete_pages", page_numbers: pages };
      break;
    default:
      throw new AxiError(`invalid --op '${op}'`, "VALIDATION_ERROR", [
        "valid values: insert_pages | move_pages | delete_pages",
      ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "merge-designs",
    {
      ...(createNew
        ? { type: "create_new_design", title: parsed.strings["new-title"] }
        : { type: "modify_existing_design", design_id: designId }),
      operations: [operation],
    },
    TIMEOUTS.job,
  );
  const view = mergeView(payload);
  view.help = [
    "verify the page order: canva-axi design pages <id>",
    ...(op === "delete_pages" ? ["deleted pages cannot be restored"] : []),
  ];
  return emit(view, jsonWanted(parsed));
}

async function importSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, importSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("design import creates a new design and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi design import <url> <name> --confirm",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "import-design-from-url",
    {
      url: parsed.positionals[0]!,
      name: parsed.positionals[1]!,
      ...(parsed.strings.type ? { intended_design_type: parsed.strings.type } : {}),
    },
    TIMEOUTS.job,
  );
  const view = serverJobView(payload, ["give the user the edit_url to review the import"]);
  return emit(view, jsonWanted(parsed));
}
