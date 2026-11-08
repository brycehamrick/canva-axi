/**
 * Payload → view shaping. Every view is what the SDK serializes to TOON:
 * 3–4 fields per row, pre-computed counts, truncated text with size hints,
 * and a help[] block of next steps (AXI principles 1–5, 9).
 *
 * TOON 4.x auto-infers `key[N]{fields}:` schemas from uniform record rows,
 * so views return plain arrays and let the encoder do the compaction.
 */

export const DEFAULT_TEXT_LIMIT = 160;

export function truncate(text: string, limit: number = DEFAULT_TEXT_LIMIT): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit)}… (${clean.length} chars total — use --full)`;
}

/** Unix seconds → YYYY-MM-DD (compact, sortable, timezone-free). */
export function unixDate(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export interface ViewOptions {
  full?: boolean;
}

function pickRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Uniform-row list block: { count, <key>: rows | "empty message", help } */
function listBlock(
  key: string,
  rows: Record<string, unknown>[],
  emptyMessage: string,
  help: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { count: rows.length, ...extra };
  out[key] = rows.length === 0 ? emptyMessage : rows;
  out.help = help;
  return out;
}

/* ------------------------------------------------------------------ */
/* Designs                                                             */
/* ------------------------------------------------------------------ */

export function designUrl(design: Record<string, unknown>): string {
  const urls = pickRecord(design.urls);
  const edit = urls.edit_url ?? design.edit_url ?? design.url;
  return typeof edit === "string" ? edit : "";
}

export function designRow(design: Record<string, unknown>): Record<string, unknown> {
  const types = Array.isArray(design.design_types) ? design.design_types.join("+") : "";
  return {
    id: String(design.id ?? ""),
    title: truncate(String(design.title ?? "")),
    pages: design.page_count ?? "",
    type: types,
    updated: design.updated_at !== undefined ? unixDate(design.updated_at) : "",
  };
}

export function designDetailView(
  design: Record<string, unknown>,
  opts: ViewOptions = {},
): Record<string, unknown> {
  const urls = pickRecord(design.urls);
  const owner = pickRecord(design.owner);
  const print = pickRecord(design.print);
  const thumbnail = pickRecord(design.thumbnail);
  return {
    design: {
      id: String(design.id ?? ""),
      title: opts.full ? String(design.title ?? "") : truncate(String(design.title ?? ""), 200),
      edit_url: String(urls.edit_url ?? design.edit_url ?? design.url ?? ""),
      ...(urls.view_url ? { view_url: String(urls.view_url) } : {}),
      ...(design.page_count !== undefined ? { pages: design.page_count } : {}),
      ...(Array.isArray(design.design_types) && design.design_types.length
        ? { types: design.design_types.join(",") }
        : {}),
      ...(design.updated_at !== undefined ? { updated: unixDate(design.updated_at) } : {}),
      ...(design.created_at !== undefined ? { created: unixDate(design.created_at) } : {}),
      ...(owner.user_id ? { owner: String(owner.user_id) } : {}),
      ...(thumbnail.url ? { thumbnail_expires_15m: String(thumbnail.url) } : {}),
      ...(print.is_printable === true ? { print_url: String(print.print_url ?? "") } : {}),
    },
  };
}

export function searchDesignsView(payload: Record<string, unknown>): Record<string, unknown> {
  const results = Array.isArray(payload.results) ? payload.results.map(pickRecord) : [];
  // `url` always present (empty when absent) so every row shares one schema
  // and TOON emits the compact {id,title,url} row form.
  const rows = results.map((design) => ({
    id: String(design.id ?? ""),
    title: truncate(String(design.title ?? design.text ?? "")),
    url: design.url ? String(design.url) : "",
  }));
  return listBlock(
    "results",
    rows,
    "none — 0 designs matched",
    [
      "try a shorter or different query",
      "browse folders instead: canva-axi folder ls root",
    ],
    payload.continuation ? { continuation: String(payload.continuation) } : {},
  );
}

export function pagesView(payload: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(payload.items) ? payload.items.map(pickRecord) : [];
  const rows = items.map((page) => {
    const dims = pickRecord(page.dimensions);
    return {
      page: page.page_number ?? page.index ?? "",
      id: String(page.id ?? ""),
      size: dims.width ? `${dims.width}x${dims.height}` : "",
    };
  });
  return listBlock("pages", rows, "none — the design has no pages", [
    "export one page: canva-axi export <design-id> --format png --pages 1",
    "edit page 1: canva-axi edit start <design-id>",
  ]);
}

/* ------------------------------------------------------------------ */
/* Jobs (create-design, separate-image-layers polls)                   */
/* ------------------------------------------------------------------ */

export function pendingJobView(payload: Record<string, unknown>): Record<string, unknown> {
  const policy = pickRecord(payload.polling_policy);
  const wait = policy.wait_seconds ?? "";
  const out: Record<string, unknown> = {
    job_id: String(payload.job_id ?? ""),
    status: String(payload.status ?? "in_progress"),
    ...(payload.continuation_token ? { continuation_token: String(payload.continuation_token) } : {}),
    ...(wait !== "" ? { wait_seconds: wait } : {}),
    ...(policy.instructions ? { instructions: truncate(String(policy.instructions), 400) } : {}),
  };
  out.help = [
    `wait ${wait !== "" ? `${wait}s` : "the instructed time"}, then: canva-axi design job <job_id> --token <continuation_token>`,
  ];
  return out;
}

export function completedJobView(payload: Record<string, unknown>): Record<string, unknown> {
  const design = pickRecord(payload.design);
  const detail = designDetailView(design).design as Record<string, unknown>;
  const out: Record<string, unknown> = {
    job_id: String(payload.job_id ?? ""),
    status: String(payload.status ?? ""),
    ...detail,
  };
  out.help = [`edit it: canva-axi edit start ${String(design.id ?? "<id>")}`];
  return out;
}

/** Server-wrapped job object: { job: { id, status, result?, error?, urls? } } */
export function serverJobView(
  payload: Record<string, unknown>,
  nextSteps: string[],
): Record<string, unknown> {
  const job = pickRecord(payload.job);
  const result = pickRecord(job.result);
  const urls = Array.isArray(job.urls) ? job.urls.map(String) : [];
  const out: Record<string, unknown> = {
    job: {
      id: String(job.id ?? ""),
      status: String(job.status ?? ""),
      ...(urls.length ? { urls } : {}),
    },
  };
  const inner: Record<string, unknown> = {};
  if (result.design !== undefined) {
    Object.assign(inner, designDetailView(pickRecord(result.design)).design);
  }
  if (Array.isArray(result.generated_designs)) {
    inner.candidates = result.generated_designs.map((candidate) => {
      const c = pickRecord(candidate);
      return {
        candidate_id: String(c.candidate_id ?? ""),
        url: String(c.url ?? ""),
      };
    });
  }
  if (Array.isArray(result.designs)) {
    inner.designs = result.designs.map((d) => designRow(pickRecord(d)));
  }
  if (result.answer !== undefined) {
    inner.answer = result.answer;
  }
  if (Object.keys(inner).length) out.result = inner;
  out.help = nextSteps;
  return out;
}

/* ------------------------------------------------------------------ */
/* Editing transactions                                                */
/* ------------------------------------------------------------------ */

export function transactionView(
  payload: Record<string, unknown>,
  designId: string,
): Record<string, unknown> {
  const transaction = pickRecord(payload.transaction);
  const richtexts = Array.isArray(payload.richtexts) ? payload.richtexts.map(pickRecord) : [];
  const fills = Array.isArray(payload.fills) ? payload.fills.map(pickRecord) : [];
  const pages = Array.isArray(payload.pages) ? payload.pages.map(pickRecord) : [];
  const textRows = richtexts.map((item) => {
    const regions = Array.isArray(item.regions) ? item.regions.map(pickRecord) : [];
    const text = regions.map((r) => String(r.text ?? "")).join("");
    return {
      element_id: String(item.element_id ?? ""),
      page: item.page_index ?? "",
      text: truncate(text),
    };
  });
  const fillRows = fills.map((item) => ({
    element_id: String(item.element_id ?? ""),
    page: item.page_index ?? "",
    type: String(item.type ?? ""),
    asset_id: String(item.asset_id ?? ""),
  }));
  const pageRows = pages.map((page) => {
    const dims = pickRecord(page.dimension);
    return {
      page: page.page_number ?? "",
      size: dims.width ? `${dims.width}x${dims.height}` : "",
      responsive: page.is_responsive === true ? "yes" : "no",
    };
  });
  return {
    transaction_id: String(transaction.transaction_id ?? transaction.id ?? ""),
    status: String(transaction.status ?? "open"),
    design: designId,
    elements: { richtexts: textRows.length, fills: fillRows.length },
    ...(textRows.length ? { richtexts: textRows } : {}),
    ...(fillRows.length ? { fills: fillRows } : {}),
    ...(pageRows.length ? { pages: pageRows } : {}),
    help: [
      'apply an edit: canva-axi edit perform <txn-id> --page 1 --op replace_text --element <element_id> --text "New headline"',
      "save: canva-axi edit commit <txn-id> --confirm",
      "discard: canva-axi edit cancel <txn-id>",
    ],
  };
}

export function performResultView(payload: Record<string, unknown>): Record<string, unknown> {
  const results = Array.isArray(payload.edit_operation_results)
    ? payload.edit_operation_results.map(pickRecord)
    : [];
  const ok = results.filter((r) => String(r.status ?? "") === "success").length;
  const rows = results.map((r) => {
    const info = pickRecord(r.operation_info);
    return {
      status: String(r.status ?? ""),
      type: String(info.type ?? ""),
      element: String(info.element_id ?? ""),
    };
  });
  return {
    operations: {
      total: results.length,
      success: ok,
      failed: results.length - ok,
    },
    ...(rows.length ? { results: rows } : {}),
    help: [
      "apply more edits with another canva-axi edit perform",
      "save everything: canva-axi edit commit <txn-id> --confirm",
      "discard: canva-axi edit cancel <txn-id>",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

function threadRow(item: Record<string, unknown>): Record<string, unknown> {
  const threadType = pickRecord(item.thread_type);
  const content = pickRecord(threadType.content);
  const author = pickRecord(item.author);
  return {
    id: String(item.id ?? ""),
    author: String(author.display_name ?? ""),
    text: truncate(String(content.plaintext ?? "")),
    at: item.created_at !== undefined ? unixDate(item.created_at) : "",
  };
}

export function commentsView(payload: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(payload.items) ? payload.items.map(pickRecord) : [];
  return listBlock(
    "comments",
    items.map(threadRow),
    "none — no comment threads on this design",
    items.length
      ? [
          "read replies: canva-axi comment replies <design-id> <comment-id>",
          'reply: canva-axi comment reply <design-id> <comment-id> --message "..." --confirm',
        ]
      : ['add the first comment: canva-axi comment add <design-id> --message "..." --confirm'],
    payload.continuation ? { continuation: String(payload.continuation) } : {},
  );
}

export function repliesView(payload: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(payload.items) ? payload.items.map(pickRecord) : [];
  const rows = items.map((item) => {
    const content = pickRecord(item.content);
    const author = pickRecord(item.author);
    return {
      id: String(item.id ?? ""),
      author: String(author.display_name ?? ""),
      text: truncate(String(content.plaintext ?? "")),
    };
  });
  return listBlock("replies", rows, "none — no replies in this thread", [
    'reply: canva-axi comment reply <design-id> <comment-id> --message "..." --confirm',
  ]);
}

export function commentCreatedView(
  payload: Record<string, unknown>,
  isReply: boolean,
): Record<string, unknown> {
  const source = pickRecord(payload.thread ?? payload.reply);
  const content = pickRecord(isReply ? source.content : pickRecord(source.thread_type).content);
  return {
    created: {
      id: String(source.id ?? ""),
      ...(source.thread_id ? { thread_id: String(source.thread_id) } : {}),
      text: truncate(String(content.plaintext ?? "")),
    },
    help: isReply
      ? ["list the thread: canva-axi comment replies <design-id> <comment-id>"]
      : ['reply to it: canva-axi comment reply <design-id> <comment-id> --message "..." --confirm'],
  };
}

/* ------------------------------------------------------------------ */
/* Folders                                                             */
/* ------------------------------------------------------------------ */

export function foldersView(payload: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(payload.items) ? payload.items.map(pickRecord) : [];
  const rows = items.map((folder) => ({
    id: String(folder.id ?? ""),
    name: truncate(String(folder.name ?? "")),
    updated: folder.updated_at !== undefined ? unixDate(folder.updated_at) : "",
  }));
  return listBlock("folders", rows, "none — 0 folders matched", [
    "list contents: canva-axi folder ls <folder-id>",
    'create one: canva-axi folder create --name "Q4 campaign" --confirm',
  ]);
}

export function folderItemsView(payload: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(payload.items) ? payload.items.map(pickRecord) : [];
  const rows = items.map((item) => {
    const type = String(item.type ?? "");
    const inner = pickRecord(item[type]);
    const label =
      type === "design"
        ? String(inner.title ?? "")
        : type === "folder"
          ? String(inner.name ?? "")
          : String(inner.name ?? inner.id ?? "");
    return {
      type,
      id: String(inner.id ?? ""),
      name: truncate(label),
      pages: type === "design" && inner.page_count !== undefined ? inner.page_count : "",
    };
  });
  const byType: Record<string, number> = {};
  for (const row of rows) byType[String(row.type)] = (byType[String(row.type)] ?? 0) + 1;
  const summary = Object.entries(byType)
    .map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`)
    .join(", ");
  return listBlock(
    "items",
    rows,
    "empty — this folder has no designs, folders, or images",
    [
      "open a design: canva-axi design get <id>",
      "move an item here: canva-axi folder move <item-id> <folder-id> --confirm",
    ],
    summary ? { contents: summary } : {},
  );
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

export function exportFormatsView(payload: Record<string, unknown>): Record<string, unknown> {
  const formats = pickRecord(payload.formats);
  const rows = Object.entries(formats).map(([format, value]) => {
    const detail = pickRecord(value);
    const pages = Array.isArray(detail.page_numbers) ? detail.page_numbers.join("+") : "all";
    return { format, pages };
  });
  const out: Record<string, unknown> = {
    formats: rows.length === 0 ? "none — this design cannot be exported" : rows,
  };
  out.help = ["export: canva-axi export <design-id> --format <format>"];
  return out;
}

export function exportView(payload: Record<string, unknown>): Record<string, unknown> {
  const job = pickRecord(payload.job);
  const urls = Array.isArray(job.urls) ? job.urls.map(String) : [];
  return {
    export: {
      status: String(job.status ?? ""),
      ...(urls.length === 1 ? { url: urls[0] } : urls.length ? { urls } : {}),
    },
    help: [
      "signed download URLs expire quickly — download now",
      "other formats: canva-axi export formats <design-id>",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Assets and images                                                   */
/* ------------------------------------------------------------------ */

/** get-assets returns a content block per requested id (asset JSON or error JSON). */
export function assetsView(payload: Record<string, unknown>): Record<string, unknown> {
  const blocks = Array.isArray(payload.blocks)
    ? payload.blocks.map(pickRecord)
    : [pickRecord(payload.asset)].filter((b) => Object.keys(b).length);
  const rows: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const asset = pickRecord(block.asset);
    if (asset.id !== undefined) {
      const metadata = pickRecord(asset.metadata);
      rows.push({
        id: String(asset.id ?? ""),
        type: String(asset.type ?? ""),
        name: truncate(String(asset.name ?? "")),
        ...(metadata.width ? { size: `${metadata.width}x${metadata.height}` } : {}),
        ...(Array.isArray(asset.tags) && asset.tags.length ? { tags: asset.tags.join(",") } : {}),
      });
    } else {
      const error = pickRecord(block.error);
      errors.push({
        error: String(error.code ?? "lookup_failed"),
        message: truncate(String(error.message ?? "")),
      });
    }
  }
  return {
    found: rows.length,
    ...(errors.length ? { failed: errors.length } : {}),
    ...(rows.length ? { assets: rows } : {}),
    ...(errors.length ? { lookup_errors: errors } : {}),
    help: ["use the asset id in edits: canva-axi edit perform <txn> --op update_fill --asset <asset_id>"],
  };
}

export function mediaResultView(
  payload: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const results = Array.isArray(payload.results) ? payload.results.map(pickRecord) : [];
  const first = pickRecord(results[0]);
  return {
    [label]: {
      status: "created",
      media_id: String(first.id ?? ""),
      ...(results.length > 1 ? { additional: results.length - 1 } : {}),
    },
    help: ["reference it by media id in generate image --ref or editing fills"],
  };
}

export function imageJobStatusView(payload: Record<string, unknown>): Record<string, unknown> {
  const status = String(payload.status ?? "");
  if (status === "SUCCESS") return mediaResultView(payload, "image");
  const out: Record<string, unknown> = {
    status,
    ...(payload.failureType ? { failure_type: String(payload.failureType) } : {}),
    ...(payload.failureMessage ? { message: truncate(String(payload.failureMessage)) } : {}),
  };
  out.help =
    status === "PENDING"
      ? ["poll again in a few seconds with the same command — don't start a new job"]
      : ["the job failed — adjust the prompt and start a new job"];
  return out;
}

export function moveView(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    moved: String(payload.status ?? ""),
    ...(payload.folder_url ? { folder_url: String(payload.folder_url) } : {}),
    help: ["browse the destination: canva-axi folder ls <folder-id>"],
  };
}

export function mergeView(payload: Record<string, unknown>): Record<string, unknown> {
  const job = pickRecord(payload.job);
  const result = pickRecord(job.result);
  const detail = designDetailView(pickRecord(result.design)).design as Record<string, unknown>;
  return {
    merge: {
      status: String(job.status ?? ""),
      ...detail,
    },
    help: ["verify the page order: canva-axi design pages <id>"],
  };
}

/* ------------------------------------------------------------------ */
/* Brand kits and templates                                            */
/* ------------------------------------------------------------------ */

export function brandKitsView(payload: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(payload.items) ? payload.items.map(pickRecord) : [];
  const rows = items.map((kit) => ({
    id: String(kit.id ?? ""),
    name: truncate(String(kit.name ?? "")),
  }));
  return listBlock(
    "brand_kits",
    rows,
    "none — Brand Kits need Canva Pro and above (an empty result is also what Free plans see)",
    ["list templates in one: canva-axi template search --brand-kit <id>"],
  );
}

export function templatesView(payload: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(payload.items) ? payload.items.map(pickRecord) : [];
  const rows = items.map((tpl) => ({
    id: String(tpl.id ?? ""),
    title: truncate(String(tpl.title ?? "")),
    type: Array.isArray(tpl.design_types) && tpl.design_types.length ? tpl.design_types.join("+") : "",
  }));
  return listBlock(
    "templates",
    rows,
    "none — 0 templates matched (Brand Templates need Canva Pro; Free plans see an empty list)",
    [
      "start a design from one: canva-axi template create <id> --confirm",
      "check its autofill fields: canva-axi template dataset <id>",
    ],
  );
}

export function datasetView(
  payload: Record<string, unknown>,
  source: string,
  sourceId: string,
): Record<string, unknown> {
  const dataset = pickRecord(payload.dataset);
  const entries = Object.entries(dataset).map(([name, value]) => ({
    field: name,
    type: String(pickRecord(value).type ?? ""),
  }));
  const out: Record<string, unknown> = {
    [source]: sourceId,
    fields: entries.length === 0 ? "empty — no autofill fields (or the plan lacks autofill)" : entries,
  };
  out.help = entries.length
    ? ['fill them: canva-axi autofill --template <id> --data \'{"field":"value"}\' --confirm']
    : ["pick a different template: canva-axi template search <query>"];
  return out;
}

/* ------------------------------------------------------------------ */
/* Design content (text reading)                                       */
/* ------------------------------------------------------------------ */

export function designContentView(
  payload: Record<string, unknown>,
  opts: ViewOptions = {},
  ref?: string,
): Record<string, unknown> {
  const metadata = pickRecord(payload.metadata);
  const text = typeof payload.text === "string" ? payload.text : "";
  const designBlock: Record<string, unknown> = {
    id: String(payload.id ?? ref ?? ""),
    title: payload.title !== undefined ? (opts.full ? String(payload.title) : truncate(String(payload.title), 200)) : "",
    ...(payload.url ? { url: String(payload.url) } : {}),
    ...(metadata.page_count !== undefined ? { pages: metadata.page_count } : {}),
    ...(metadata.updated_at !== undefined ? { updated: unixDate(metadata.updated_at) } : {}),
  };
  return {
    design: designBlock,
    text: text ? (opts.full ? text : truncate(text, 1200)) : "(no text content returned)",
    help: [
      "get editable element ids instead: canva-axi edit start <design-id>",
      "pages and thumbnails: canva-axi design pages <design-id>",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Design content (text reading)                                       */
/* ------------------------------------------------------------------ */
