import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS, DEFAULT_LIMIT } from "../canva/client.js";
import { emit, jsonWanted, normalizeDesignId, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import {
  searchDesignsView,
  designDetailView,
  designContentView,
  pagesView,
  pendingJobView,
  completedJobView,
} from "../render.js";
import { designopsCommand } from "./designops.js";

/**
 * Design discovery and per-design reads: search, get, content, pages, job
 * polls, plus create (brief → design) with its async job flow.
 */

const searchSpec: CommandArgsSpec = {
  command: "design search",
  args: [{ name: "query", required: false, description: "keyword to match titles (omit to list recent designs)" }],
  flags: [
    { name: "limit", type: "string", default: String(DEFAULT_LIMIT), description: "max results (1-100)" },
    {
      name: "ownership",
      type: "string",
      values: ["any", "owned", "shared"],
      description: "whose designs (omit = any)",
    },
    {
      name: "sort",
      type: "string",
      values: ["relevance", "modified_descending", "modified_ascending", "title_descending", "title_ascending"],
      description: "order (omitting a query defaults to modified_descending)",
    },
    { name: "continuation", type: "string", description: "pagination token from a previous page" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const getSpec: CommandArgsSpec = {
  command: "design get",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

const contentSpec: CommandArgsSpec = {
  command: "design content",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [
    { name: "full", type: "boolean", description: "show the complete text without truncation" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const pagesSpec: CommandArgsSpec = {
  command: "design pages",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const notesSpec: CommandArgsSpec = {
  command: "design notes",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [
    { name: "full", type: "boolean", description: "show complete notes without truncation" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const jobSpec: CommandArgsSpec = {
  command: "design job",
  args: [{ name: "job-id", required: true, description: "job_id from design create or image layers" }],
  flags: [
    { name: "token", type: "string", description: "continuation token from the job's most recent response" },
    { name: "kind", type: "string", values: ["design", "layers"], default: "design", description: "which job family created it" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const thumbnailSpec: CommandArgsSpec = {
  command: "edit thumbnail",
  args: [
    { name: "txn-id", required: true, description: "transaction_id from edit start" },
    { name: "page", required: true, description: "1-based page index" },
  ],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

const createSpec: CommandArgsSpec = {
  command: "design create",
  args: [{ name: "brief", required: true, description: "what to create, in the user's own words" }],
  flags: [
    { name: "format", type: "string", description: "target format, e.g. \"Instagram Post\" or \"Flyer (Landscape A4)\"" },
    { name: "outline", type: "string", description: "JSON presentation outline: {\"sections\":[...]} (presentations)" },
    { name: "wait", type: "string", values: ["true", "false"], default: "true", description: "poll to completion inside this command" },
    { name: "confirm", type: "boolean", description: "required: creates a new design in your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

export const designHelp = [
  renderCommandHelp({
    spec: searchSpec,
    summary: "Find designs in your library by keyword",
    examples: ["canva-axi design search q1", "canva-axi design search", "canva-axi design search deck --limit 30"],
  }),
  renderCommandHelp({
    spec: getSpec,
    summary: "Get one design's metadata: title, owner, URLs, page count, timestamps",
    examples: ["canva-axi design get DAFtmABcN3s"],
  }),
  renderCommandHelp({
    spec: contentSpec,
    summary: "Read a design's text content (read-only; for editing element ids use edit start)",
    examples: ["canva-axi design content DAFtmABcN3s", "canva-axi design content DAFtmABcN3s --full"],
  }),
  renderCommandHelp({
    spec: pagesSpec,
    summary: "List pages with dimensions for a multi-page design",
    examples: ["canva-axi design pages DAFtmABcN3s"],
  }),
  renderCommandHelp({
    spec: notesSpec,
    summary: "Read a presentation's presenter notes",
    examples: ["canva-axi design notes DAFtmABcN3s", "canva-axi design notes DAFtmABcN3s --full"],
  }),
  renderCommandHelp({
    spec: jobSpec,
    summary: "Poll a design-creation or image-layer job; returns the finished design",
    examples: ["canva-axi design job job_abc --token tok123", "canva-axi design job job_abc --token tok123 --kind layers"],
  }),
  renderCommandHelp({
    spec: createSpec,
    summary: "Create a new editable design from a written brief (async job; polls to completion by default)",
    examples: [
      'canva-axi design create "5-slide sales deck introducing our AI feature"',
      'canva-axi design create "Instagram post" --format "Instagram Post"',
    ],
  }),
].join("\n\n");

export async function designCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  // Design-level operations dispatch to their own module.
  if (args[0] === "copy" || args[0] === "resize" || args[0] === "merge" || args[0] === "import") {
    return designopsCommand(args, deps);
  }
  const subcommand = args[0];
  switch (subcommand) {
    case "search":
      return searchSub(args.slice(1), deps);
    case "get":
      return getSub(args.slice(1), deps);
    case "content":
      return contentSub(args.slice(1), deps);
    case "pages":
      return pagesSub(args.slice(1), deps);
    case "notes":
      return notesSub(args.slice(1), deps);
    case "thumbnail":
      throw new AxiError(
        "design thumbnail moved to the editing flow (the server scopes it to open transactions)",
        "VALIDATION_ERROR",
        ["run: canva-axi edit thumbnail <txn-id> <page> (txn from `canva-axi edit start`)"],
      );
    case "job":
      return jobSub(args.slice(1), deps);
    case "create":
      return createSub(args.slice(1), deps);
    case undefined:
      // Bare `canva-axi design` treats the first arg as a design ref: list
      // recent designs when no ref, show the design when one is given.
      if (args.length === 0) return searchSub([], deps);
      throw missingSub("design", "search | get | content | pages | notes | thumbnail | job | create | copy | resize | merge | import", args);
    default:
      // `canva-axi design <ref>` → show that design.
      if (/^D[A-Za-z0-9_-]{5,}$/.test(subcommand) || /canva\.com/.test(subcommand)) {
        return getSub(args, deps);
      }
      throw unknownSub("design", subcommand, "search | get | content | pages | notes | thumbnail | job | create | copy | resize | merge | import");
  }
}

function missingSub(command: string, valid: string, args: string[]): AxiError {
  return new AxiError(`missing subcommand for '${command}'`, "VALIDATION_ERROR", [
    `usage: canva-axi ${command} ${valid}`,
    `Run \`canva-axi ${command} --help\` for details`,
  ]);
}

function unknownSub(command: string, sub: string, valid: string): AxiError {
  return new AxiError(`unknown ${command} subcommand '${sub}'`, "VALIDATION_ERROR", [
    `valid subcommands: ${valid}`,
    `Run \`canva-axi ${command} --help\` for details`,
  ]);
}

async function searchSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, searchSpec);
  const api = deps.createApi();
  const limit = clampLimit(parsed.strings.limit, "design search");
  const query = parsed.positionals[0] ?? "";
  // Live schema: sort_by=relevance (the default) matches nothing without a
  // query — browse mode must ask for newest-first explicitly.
  const sortBy =
    parsed.strings.sort ?? (query ? "relevance" : "modified_descending");
  const payload = await api.call(
    "search-designs",
    {
      query,
      sort_by: sortBy,
      limit,
      ...(parsed.strings.ownership ? { ownership: parsed.strings.ownership } : {}),
      ...(parsed.strings.continuation ? { continuation: parsed.strings.continuation } : {}),
    },
    TIMEOUTS.fast,
  );
  return emit(searchDesignsView(payload), jsonWanted(parsed));
}

async function getSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, getSpec);
  const api = deps.createApi();
  const ref = normalizeDesignId(parsed.positionals[0]!);
  const payload = await api.call("get-design", { design_id: ref }, TIMEOUTS.fast);
  const design = (payload.design ?? {}) as Record<string, unknown>;
  const view = designDetailView(design);
  view.help = [
    `read text: canva-axi design content ${ref}`,
    `export: canva-axi export ${ref} --format pdf`,
    `edit: canva-axi edit start ${ref}`,
  ];
  return emit(view, jsonWanted(parsed));
}

async function contentSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, contentSpec);
  const api = deps.createApi();
  const ref = normalizeDesignId(parsed.positionals[0]!);
  const payload = await api.call(
    "get-design-content",
    { design_id: ref, content_types: ["richtexts"] },
    TIMEOUTS.fast,
  );
  return emit(designContentView(payload, { full: parsed.booleans.full === true }, ref), jsonWanted(parsed));
}

async function pagesSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, pagesSpec);
  const api = deps.createApi();
  const ref = normalizeDesignId(parsed.positionals[0]!);
  const payload = await api.call("get-design-pages", { design_id: ref }, TIMEOUTS.fast);
  return emit(pagesView(payload), jsonWanted(parsed));
}

async function notesSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, notesSpec);
  const api = deps.createApi();
  const ref = normalizeDesignId(parsed.positionals[0]!);
  const payload = await api.call("get-presenter-notes", { design_id: ref }, TIMEOUTS.fast);
  // Response shape: notes text per design (see canva.dev docs); degrade
  // gracefully across shapes — notes | items[].notes | text.
  const items = Array.isArray(payload.items) ? payload.items : null;
  if (items) {
    const rows = items.map((item, index) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const noteText = String(record.notes ?? record.text ?? record.plaintext ?? "");
      return {
        page: record.page_number ?? record.page ?? index + 1,
        notes: parsed.booleans.full ? noteText : truncateNote(noteText),
      };
    });
    return emit(
      {
        count: rows.length,
        ...(rows.length ? { notes: rows } : { notes: "none — this design has no presenter notes" }),
        help: ["edit notes inside Canva: canva-axi design get <id> for the edit_url"],
      },
      jsonWanted(parsed),
    );
  }
  const noteText = String(payload.notes ?? payload.text ?? "");
  return emit(
    {
      notes: noteText
        ? parsed.booleans.full
          ? noteText
          : truncateNote(noteText)
        : "none — this design has no presenter notes",
      help: ["edit notes inside Canva: canva-axi design get <id> for the edit_url"],
    },
    jsonWanted(parsed),
  );
}

function truncateNote(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 400) return clean;
  return `${clean.slice(0, 400)}… (${clean.length} chars total — use --full)`;
}

/** Shared with the edit flow: the server scopes thumbnails to open transactions. */
export async function thumbnailSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {  const parsed = parseCommandArgs(args, thumbnailSpec);
  const api = deps.createApi();
  const page = Number(parsed.positionals[1]!);
  if (!Number.isInteger(page) || page < 1) {
    throw new AxiError(`invalid page '${parsed.positionals[1]}'`, "VALIDATION_ERROR", [
      "use a 1-based page index",
    ]);
  }
  const payload = await api.call(
    "get-design-thumbnail",
    { transaction_id: parsed.positionals[0]!, page_index: page },
    TIMEOUTS.fast,
  );
  // Graceful shape handling: { thumbnail: { url } } | { url } | { thumbnails: [...] }
  const nested = (payload.thumbnail ?? {}) as Record<string, unknown>;
  const list = Array.isArray(payload.thumbnails) ? payload.thumbnails : [];
  const firstList = (list[0] ?? {}) as Record<string, unknown>;
  const url = String(nested.url ?? payload.url ?? firstList.url ?? "");
  return emit(
    {
      ...(url ? { thumbnail_expires_15m: url } : { thumbnail: "none returned" }),
      help: [
        "signed URL — open or download it immediately, never store or share it",
        "per-page thumbnails: canva-axi design pages <id>",
      ],
    },
    jsonWanted(parsed),
  );
}

async function jobSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, jobSpec);
  const api = deps.createApi();
  const jobId = parsed.positionals[0]!;
  const kind = parsed.strings.kind ?? "design";
  const tool = kind === "layers" ? "get-separate-image-layers-job" : "get-create-design-async-job";
  const payload = await api.call(
    tool,
    {
      job_id: jobId,
      ...(parsed.strings.token ? { continuation_token: parsed.strings.token } : {}),
    },
    TIMEOUTS.poll,
  );
  const status = String(payload.status ?? "");
  if (status === "completed") {
    const view = completedJobView(payload);
    return emit(view, jsonWanted(parsed));
  }
  if (status === "polled_too_early") {
    const view = pendingJobView({ ...payload, status: "polled_too_early" });
    view.help = ["you polled before wait_seconds elapsed — wait, then re-run the same command"];
    return emit(view, jsonWanted(parsed));
  }
  return emit(pendingJobView(payload), jsonWanted(parsed));
}

async function createSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, createSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("design create adds a new design to your account and requires --confirm", "VALIDATION_ERROR", [
      're-run with --confirm: canva-axi design create "<brief>" --confirm',
    ]);
  }
  const api = deps.createApi();
  const brief = parsed.positionals[0]!;
  let outline: unknown;
  if (parsed.strings.outline) {
    outline = parseJsonFlag(parsed.strings.outline, "outline");
  }
  const start = await api.call(
    "create-design",
    {
      brief,
      ...(parsed.strings.format ? { format: parsed.strings.format } : {}),
      ...(outline !== undefined ? { outline } : {}),
    },
    TIMEOUTS.job,
  );
  if (parsed.strings.wait === "false") {
    return emit(pendingJobView(start), jsonWanted(parsed));
  }
  let payload = start;
  let guard = 0;
  for (;;) {
    const status = String(payload.status ?? "");
    if (status === "completed") return emit(completedJobView(payload), jsonWanted(parsed));
    if (status === "failed" || payload.failure) {
      return emit(
        {
          job_id: String(payload.job_id ?? ""),
          status: "failed",
          failure: payload.failure ?? {},
        },
        jsonWanted(parsed),
      );
    }
    if (guard++ > 40) {
      const view = pendingJobView(payload);
      view.help = ["polling stopped after ~10 min; resume with: canva-axi design job <job_id> --token <token>"];
      return emit(view, jsonWanted(parsed));
    }
    const policy = (payload.polling_policy ?? {}) as Record<string, unknown>;
    const waitMs = typeof policy.wait_seconds === "number" ? policy.wait_seconds * 1000 : 15_000;
    await sleep(waitMs);
    payload = await api.call(
      "get-create-design-async-job",
      {
        job_id: String(start.job_id ?? ""),
        continuation_token: String(payload.continuation_token ?? ""),
      },
      TIMEOUTS.poll,
    );
  }
}

function parseJsonFlag(value: string, flag: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AxiError(`--${flag} must be valid JSON`, "VALIDATION_ERROR", [
      `example: --${flag} '{"sections":["Intro","Details"]}'`,
    ]);
  }
}

export function clampLimit(value: string | undefined, command: string): number {
  const limit = Number(value ?? String(DEFAULT_LIMIT));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AxiError(`invalid --limit '${value}' for ${command}`, "VALIDATION_ERROR", [
      "use an integer between 1 and 100",
    ]);
  }
  return limit;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
