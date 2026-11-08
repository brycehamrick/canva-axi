import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { mediaResultView, assetsView } from "../render.js";

/**
 * Image utilities: remove-background (creates a new image), assets lookup,
 * upload from URL, create-upload-url, layers (image → design). Uploads and
 * background removal create content in the account → --confirm.
 */

const removeBgSpec: CommandArgsSpec = {
  command: "image remove-bg",
  args: [{ name: "media-id", required: true, description: "MEDIA id of the image in your Canva account" }],
  flags: [
    { name: "confirm", type: "boolean", description: "required: creates a new image in your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const assetsSpec: CommandArgsSpec = {
  command: "image assets",
  args: [{ name: "asset-ids", required: true, description: "comma-separated image/video asset ids" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

const uploadUrlSpec: CommandArgsSpec = {
  command: "image upload-url",
  args: [{ name: "url", required: true, description: "public HTTPS url of the image or video" }],
  flags: [
    { name: "name", type: "string", description: "asset name" },
    { name: "confirm", type: "boolean", description: "required: imports the file into your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const uploadSpec: CommandArgsSpec = {
  command: "image upload",
  args: [{ name: "path", required: true, description: "local file path to upload (image, video, or document)" }],
  flags: [
    { name: "confirm", type: "boolean", description: "required: uploads the file into your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const layersSpec: CommandArgsSpec = {
  command: "image layers",
  args: [{ name: "asset-id", required: true, description: "asset id of a flat PNG/JPEG/WEBP image" }],
  flags: [
    { name: "title", type: "string", description: "title for the new design" },
    { name: "wait", type: "string", values: ["true", "false"], default: "true", description: "poll to completion" },
    { name: "confirm", type: "boolean", description: "required: creates a new design in your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

export const imageHelp = [
  renderCommandHelp({
    spec: removeBgSpec,
    summary: "Remove the background from an image (source unchanged; returns a new media id)",
    examples: ["canva-axi image remove-bg MEDIA123 --confirm"],
  }),
  renderCommandHelp({
    spec: assetsSpec,
    summary: "Look up names/tags/dimensions for image and video assets",
    examples: ["canva-axi image assets ASSET1,ASSET2"],
  }),
  renderCommandHelp({
    spec: uploadUrlSpec,
    summary: "Import a publicly hosted image or video into your Canva account",
    examples: ["canva-axi image upload-url https://example.com/logo.png --confirm"],
  }),
  renderCommandHelp({
    spec: uploadSpec,
    summary: "Upload a local file: gets a single-use upload URL, then POSTs the bytes",
    examples: ["canva-axi image upload ./logo.png --confirm"],
  }),
  renderCommandHelp({
    spec: layersSpec,
    summary: "Split a flat image into an editable design (async job; polls by default)",
    examples: ["canva-axi image layers ASSET1 --confirm", "canva-axi image layers ASSET1 --wait false --confirm"],
  }),
].join("\n\n");

export async function imageCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const sub = args[0];
  switch (sub) {
    case "remove-bg":
      return removeBgSub(args.slice(1), deps);
    case "assets":
      return assetsSub(args.slice(1), deps);
    case "upload-url":
      return uploadUrlSub(args.slice(1), deps);
    case "upload":
      return uploadSub(args.slice(1), deps);
    case "layers":
      return layersSub(args.slice(1), deps);
    case undefined:
      throw new AxiError("missing subcommand for 'image'", "VALIDATION_ERROR", [
        "valid subcommands: remove-bg | assets | upload-url | upload | layers",
        "Run `canva-axi image --help` for details",
      ]);
    default:
      throw new AxiError(`unknown image subcommand '${sub}'`, "VALIDATION_ERROR", [
        "valid subcommands: remove-bg | assets | upload-url | upload | layers",
        "Run `canva-axi image --help` for details",
      ]);
  }
}

async function removeBgSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, removeBgSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("image remove-bg creates a new image and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi image remove-bg <media-id> --confirm",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "remove-background",
    { sourceMedia: { type: "MEDIA", id: parsed.positionals[0]! } },
    TIMEOUTS.job,
  );
  return emit(mediaResultView(payload, "image"), jsonWanted(parsed));
}

async function assetsSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, assetsSpec);
  const ids = parsed.positionals[0]!.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new AxiError("image assets requires at least one asset id", "VALIDATION_ERROR", [
      "comma-separated: canva-axi image assets ASSET1,ASSET2",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call("get-assets", { asset_ids: ids }, TIMEOUTS.fast);
  return emit(assetsView(payload), jsonWanted(parsed));
}

async function uploadUrlSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, uploadUrlSpec);
  const name = parsed.strings.name ?? parsed.positionals[0]!.split("/").pop() ?? "asset";
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("image upload-url imports a file into your account and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi image upload-url <url> --confirm",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "upload-asset-from-url",
    { url: parsed.positionals[0]!, name }, // name is server-required; default from the URL basename
    TIMEOUTS.job,
  );
  const job = (payload.job ?? {}) as Record<string, unknown>;
  const result = (job.result ?? {}) as Record<string, unknown>;
  return emit(
    {
      upload: {
        status: String(job.status ?? ""),
        ...(result.asset_id ? { asset_id: String(result.asset_id) } : {}),
      },
      help: [
        ...(String(job.status ?? "") === "failed"
          ? ["fetch_failed means the URL wasn't public HTTPS or didn't return 200 — fix the URL and retry"]
          : ["use the asset id in fills or autofill image fields"]),
      ],
    },
    jsonWanted(parsed),
  );
}

async function uploadSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, uploadSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("image upload adds a file to your account and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi image upload <path> --confirm",
    ]);
  }
  const { readFile } = await import("node:fs/promises");
  const path = parsed.positionals[0]!;
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new AxiError(
      `could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "VALIDATION_ERROR",
      ["check the file path"],
    );
  }
  const api = deps.createApi();
  // Step 1: single-use upload URL.
  const urlPayload = await api.call("create-upload-url", {}, TIMEOUTS.fast);
  const uploadUrl = String(urlPayload.uploadUrl ?? "");
  if (!uploadUrl) {
    throw new AxiError("Canva returned no uploadUrl", "UPSTREAM", ["retry the command"]);
  }
  // Step 2: POST raw bytes (octet-stream, no multipart/base64).
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
  } catch (error) {
    throw new AxiError(
      `upload POST failed: ${error instanceof Error ? error.message : String(error)}`,
      "UPSTREAM",
      ["get a fresh URL and retry — never reuse a used/expired upload URL"],
    );
  }
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new AxiError(
      `upload POST returned HTTP ${response.status}: ${bodyText.slice(0, 200)}`,
      "UPSTREAM",
      ["get a fresh URL with a new run — upload URLs are single-use"],
    );
  }
  let uploaded: Record<string, unknown>;
  try {
    uploaded = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new AxiError(`upload response was not JSON: ${bodyText.slice(0, 200)}`, "UPSTREAM", [
      "the file may still have been uploaded; check with canva-axi image assets",
    ]);
  }
  const id = uploaded.mediaId ?? uploaded.videoId ?? uploaded.fileId ?? "";
  return emit(
    {
      upload: {
        status: "uploaded",
        ...(id ? { id: String(id) } : {}),
        id_field: uploaded.mediaId ? "mediaId" : uploaded.videoId ? "videoId" : uploaded.fileId ? "fileId" : "",
        bytes: bytes.length,
      },
      help: ["reference the id in generate-image --ref, fills, or autofill image fields"],
    },
    jsonWanted(parsed),
  );
}

async function layersSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, layersSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("image layers creates a new design and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi image layers <asset-id> --confirm",
    ]);
  }
  const api = deps.createApi();
  const start = await api.call(
    "separate-image-layers",
    {
      asset_id: parsed.positionals[0]!,
      ...(parsed.strings.title ? { title: parsed.strings.title } : {}),
    },
    TIMEOUTS.fast,
  );
  if (parsed.strings.wait === "false") {
    const out: Record<string, unknown> = {
      job_id: String(start.job_id ?? ""),
      status: String(start.status ?? "pending"),
      ...(start.continuation_token ? { continuation_token: String(start.continuation_token) } : {}),
    };
    out.help = ["poll with: canva-axi design job <job_id> --token <token> --kind layers"];
    return emit(out, jsonWanted(parsed));
  }
  let payload = start;
  let guard = 0;
  for (;;) {
    const status = String(payload.status ?? "");
    if (status === "completed") {
      const design = (payload.design ?? {}) as Record<string, unknown>;
      return emit(
        {
          design: {
            id: String(design.id ?? ""),
            edit_url: String(design.edit_url ?? design.url ?? ""),
          },
          help: ["the source image is unchanged; edit the new design: canva-axi edit start <id>"],
        },
        jsonWanted(parsed),
      );
    }
    if (status === "failed" || payload.failure) {
      return emit(
        { job_id: String(payload.job_id ?? ""), status: "failed", failure: payload.failure ?? {} },
        jsonWanted(parsed),
      );
    }
    if (guard++ > 30) {
      const out: Record<string, unknown> = {
        job_id: String(payload.job_id ?? ""),
        status: "in_progress",
        continuation_token: String(payload.continuation_token ?? ""),
      };
      out.help = ["polling stopped after ~5 min; resume with: canva-axi design job <job_id> --token <token> --kind layers"];
      return emit(out, jsonWanted(parsed));
    }
    const policy = (payload.polling_policy ?? {}) as Record<string, unknown>;
    const waitMs = typeof policy.wait_seconds === "number" ? policy.wait_seconds * 1000 : 10_000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    payload = await api.call(
      "get-separate-image-layers-job",
      {
        job_id: String(start.job_id ?? ""),
        continuation_token: String(payload.continuation_token ?? ""),
      },
      TIMEOUTS.poll,
    );
  }
}
