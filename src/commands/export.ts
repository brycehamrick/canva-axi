import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, normalizeDesignId, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { exportFormatsView, exportView } from "../render.js";

/**
 * Export: formats (read) and export (render-only output, so ungated — it
 * creates a downloadable file but never touches the design or account
 * data).
 */

const formatsSpec: CommandArgsSpec = {
  command: "export formats",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

const exportSpec: CommandArgsSpec = {
  command: "export",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [
    { name: "format", type: "string", values: ["pdf", "png", "jpg", "gif", "pptx", "mp4", "csv"], description: "export format" },
    { name: "pages", type: "string", description: "comma-separated 1-based pages (omit = all)" },
    { name: "quality", type: "string", description: "1-100 for jpg; e.g. horizontal_1080p for mp4" },
    { name: "export-quality", type: "string", values: ["regular", "pro"], description: "overall export quality" },
    { name: "size", type: "string", values: ["a4", "a3", "letter", "legal"], description: "paper size for pdf" },
    { name: "width", type: "string", description: "raster width (px)" },
    { name: "height", type: "string", description: "raster height (px)" },
    { name: "lossless", type: "boolean", description: "lossless PNG (Pro)" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

export const exportHelp = [
  renderCommandHelp({
    spec: formatsSpec,
    summary: "Check which formats (and pages) a design can export to",
    examples: ["canva-axi export formats DAFtmABcN3s"],
  }),
  renderCommandHelp({
    spec: exportSpec,
    summary: "Export a design to a downloadable file (signed URLs expire fast)",
    examples: [
      "canva-axi export DAFtmABcN3s --format pdf",
      "canva-axi export DAFtmABcN3s --format png --pages 1,3",
    ],
  }),
].join("\n\n");

export async function exportCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  if (args[0] === "formats") return formatsSub(args.slice(1), deps);
  return exportSub(args, deps);
}

async function formatsSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, formatsSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "get-export-formats",
    { design_id: normalizeDesignId(parsed.positionals[0]!) },
    TIMEOUTS.fast,
  );
  return emit(exportFormatsView(payload), jsonWanted(parsed));
}

async function exportSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, exportSpec);
  if (!parsed.strings.format) {
    throw new AxiError("export requires --format", "VALIDATION_ERROR", [
      "valid values: pdf, png, jpg, gif, pptx, mp4, csv",
      "check what this design supports: canva-axi export formats <design-id>",
    ]);
  }
  let pages: number[] | undefined;
  if (parsed.strings.pages) {
    pages = parsed.strings.pages.split(",").map((piece) => Number(piece.trim()));
    if (pages.some((page) => !Number.isInteger(page) || page < 1)) {
      throw new AxiError(`invalid --pages '${parsed.strings.pages}'`, "VALIDATION_ERROR", [
        "use comma-separated 1-based page numbers, e.g. --pages 1,3",
      ]);
    }
  }
  const quality = parsed.strings.quality;
  const formatObject: Record<string, unknown> = { type: parsed.strings.format };
  if (pages) formatObject.pages = pages;
  if (quality !== undefined && quality !== "") {
    // jpg takes 1-100; mp4 takes a named preset string.
    formatObject.quality = /^\d+$/.test(quality) ? Number(quality) : quality;
  }
  if (parsed.strings["export-quality"]) formatObject.export_quality = parsed.strings["export-quality"];
  if (parsed.strings.size) formatObject.size = parsed.strings.size;
  if (parsed.strings.width) formatObject.width = Number(parsed.strings.width);
  if (parsed.strings.height) formatObject.height = Number(parsed.strings.height);
  if (parsed.booleans.lossless) formatObject.lossless = true;

  const api = deps.createApi();
  const payload = await api.call(
    "export-design",
    { design_id: normalizeDesignId(parsed.positionals[0]!), format: formatObject },
    TIMEOUTS.job,
  );
  return emit(exportView(payload), jsonWanted(parsed));
}
