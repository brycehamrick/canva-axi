import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { serverJobView } from "../render.js";

/**
 * generate-design (candidates), create-design-from-candidate, and
 * generate-image. All are AI-credit consumers → --confirm gated.
 */

const designSpec: CommandArgsSpec = {
  command: "generate",
  args: [{ name: "query", required: true, description: "what to generate, in natural language" }],
  flags: [
    {
      name: "type",
      type: "string",
      values: [
        "business_card", "card", "desktop_wallpaper", "doc", "document", "email", "facebook_cover",
        "facebook_post", "flyer", "infographic", "instagram_post", "invitation", "logo",
        "phone_wallpaper", "photo_collage", "pinterest_pin", "postcard", "poster", "presentation",
        "proposal", "report", "resume", "twitter_post", "your_story", "youtube_banner", "youtube_thumbnail",
      ],
      description: "design type (required by the server)",
    },
    { name: "brand-kit", type: "string", description: "generate with a Brand Kit's styles" },
    { name: "asset", type: "repeat", description: "asset id to include (repeatable)" },
    { name: "length", type: "string", values: ["short", "balanced", "comprehensive"], description: "content length" },
    { name: "confirm", type: "boolean", description: "required: consumes Canva AI credits" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const fromCandidateSpec: CommandArgsSpec = {
  command: "generate pick",
  args: [
    { name: "job-id", required: true, description: "job id from generate (the top-level job.id)" },
    { name: "candidate-id", required: true, description: "candidate_id the user chose" },
  ],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

const imageSpec: CommandArgsSpec = {
  command: "generate image",
  args: [{ name: "prompt", required: true, description: "image prompt" }],
  flags: [
    { name: "ref", type: "repeat", description: "media id of an image to edit (repeatable)" },
    { name: "confirm", type: "boolean", description: "required: consumes Canva AI credits" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const imageJobSpec: CommandArgsSpec = {
  command: "generate image-job",
  args: [{ name: "job-id", required: true, description: "jobId from generate image" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

export const generateHelp = [
  renderCommandHelp({
    spec: designSpec,
    summary: "Generate design candidates (server job; present candidates, don't auto-pick)",
    examples: [
      'canva-axi generate "Instagram post announcing our AI feature" --type instagram_post --confirm',
    ],
  }),
  renderCommandHelp({
    spec: fromCandidateSpec,
    summary: "Turn the candidate the user picked into a real design",
    examples: ["canva-axi generate pick job_abc dg-EXAMPLE1"],
  }),
  renderCommandHelp({
    spec: imageSpec,
    summary: "Generate a standalone image, or edit reference images (async job; returns jobId)",
    examples: [
      'canva-axi generate image "watercolor lighthouse at sunset" --confirm',
      'canva-axi generate image "make the sky golden hour" --ref MEDIA1 --confirm',
    ],
  }),
  renderCommandHelp({
    spec: imageJobSpec,
    summary: "Poll an image generation job (PENDING → SUCCESS/FAILURE)",
    examples: ["canva-axi generate image-job job_abc"],
  }),
].join("\n\n");

export async function generateCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const sub = args[0];
  if (sub === "image") return imageSub(args.slice(1), deps);
  if (sub === "image-job") return imageJobSub(args.slice(1), deps);
  if (sub === "pick") return pickSub(args.slice(1), deps);
  // `canva-axi generate "<brief>" --confirm` — the brief is args[0].
  return designGenerateSub(args, deps);
}

async function designGenerateSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, designSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError(
      "generate consumes Canva AI credits and requires --confirm",
      "VALIDATION_ERROR",
      ['re-run with --confirm: canva-axi generate "<query>" --type <type> --confirm'],
    );
  }
  if (!parsed.strings.type) {
    throw new AxiError("generate requires --type (the server rejects a missing design_type)", "VALIDATION_ERROR", [
      "e.g. --type instagram_post, --type presentation, --type logo",
      "run `canva-axi generate --help` for the full list",
    ]);
  }
  const api = deps.createApi();
  const assets = parsed.repeats.asset ?? [];
  const payload = await api.call(
    "generate-design",
    {
      query: parsed.positionals[0]!,
      design_type: parsed.strings.type,
      ...(parsed.strings["brand-kit"] ? { brand_kit_id: parsed.strings["brand-kit"] } : {}),
      ...(assets.length ? { asset_ids: assets } : {}),
      ...(parsed.strings.length ? { length: parsed.strings.length } : {}),
    },
    TIMEOUTS.job,
  );
  const view = serverJobView(payload, [
    "present the candidates to the user and let them choose — don't auto-pick",
    "create the chosen one: canva-axi generate pick <job-id> <candidate_id>",
  ]);
  return emit(view, jsonWanted(parsed));
}

async function pickSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, fromCandidateSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "create-design-from-candidate",
    { job_id: parsed.positionals[0]!, candidate_id: parsed.positionals[1]! },
    TIMEOUTS.fast,
  );
  const summary = (payload.design_summary ?? {}) as Record<string, unknown>;
  const urls = (summary.urls ?? {}) as Record<string, unknown>;
  return emit(
    {
      design: {
        id: String(summary.id ?? ""),
        title: String(summary.title ?? ""),
        edit_url: String(urls.edit_url ?? ""),
        pages: summary.page_count ?? "",
      },
      help: [`edit it: canva-axi edit start ${String(summary.id ?? "<id>")}`],
    },
    jsonWanted(parsed),
  );
}

async function imageSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, imageSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError(
      "generate image consumes Canva AI credits and requires --confirm",
      "VALIDATION_ERROR",
      ['re-run with --confirm: canva-axi generate image "<prompt>" --confirm'],
    );
  }
  const api = deps.createApi();
  const refs = parsed.repeats.ref ?? [];
  const payload = await api.call(
    "generate-image",
    {
      prompt: parsed.positionals[0]!,
      ...(refs.length ? { imageReferences: refs.map((id) => ({ type: "MEDIA", id })) } : {}),
    },
    TIMEOUTS.fast,
  );
  return emit(
    {
      job: { id: String(payload.jobId ?? ""), status: "pending" },
      help: ["poll in a few seconds: canva-axi generate image-job <jobId> — don't start a new job while one runs"],
    },
    jsonWanted(parsed),
  );
}

async function imageJobSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, imageJobSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "get-generate-image-job",
    { jobId: parsed.positionals[0]! },
    TIMEOUTS.fast,
  );
  const view = imageJobView(payload);
  return emit(view, jsonWanted(parsed));
}

function imageJobView(payload: Record<string, unknown>): Record<string, unknown> {
  const status = String(payload.status ?? "");
  if (status === "SUCCESS") {
    const results = Array.isArray(payload.result)
      ? payload.result
      : Array.isArray((payload.result as Record<string, unknown> | undefined)?.results)
        ? ((payload.result as Record<string, unknown>).results as unknown[])
        : [];
    const first = (results[0] ?? {}) as Record<string, unknown>;
    return {
      image: { status: "created", media_id: String(first.id ?? "") },
      help: ["reference it by media id (generate image --ref, fills, remove-background)"],
    };
  }
  const out: Record<string, unknown> = {
    status,
    ...(payload.failureType ? { failure_type: String(payload.failureType) } : {}),
    ...(payload.failureMessage ? { message: String(payload.failureMessage) } : {}),
  };
  out.help =
    status === "PENDING"
      ? ["poll again in a few seconds with the same command — don't start a new job"]
      : ["the job failed — adjust the prompt and start a new job"];
  return out;
}
