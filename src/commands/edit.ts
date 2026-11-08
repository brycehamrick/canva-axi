import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, normalizeDesignId, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { transactionView, performResultView } from "../render.js";
import { thumbnailSub } from "./design.js";

/**
 * The editing transaction flow: start (draft) → perform (draft ops) →
 * commit (persist, --confirm) / cancel (discard).
 *
 * start and perform stay ungated because nothing persists until commit —
 * an abandoned transaction is discarded by Canva automatically. commit can
 * fail on concurrent edits (stale snapshot): the fix is cancel + fresh
 * transaction, surfaced in the error help.
 *
 * Operation shapes below mirror the live server schema exactly (verified
 * via `tools --schema perform-editing-operations`): 10 operation types,
 * each with its own required fields.
 */

const OP_TYPES = [
  "update_title",
  "replace_text",
  "find_and_replace_text",
  "update_fill",
  "insert_fill",
  "delete_element",
  "position_element",
  "resize_element",
  "format_text",
  "update_autofill_field",
] as const;

const startSpec: CommandArgsSpec = {
  command: "edit start",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

const performSpec: CommandArgsSpec = {
  command: "edit perform",
  args: [{ name: "txn-id", required: true, description: "transaction_id from edit start" }],
  flags: [
    { name: "page", type: "string", description: "1-based page index to edit (default 1)" },
    { name: "op", type: "string", values: [...OP_TYPES], description: "operation type (see --help for per-op flags)" },
    // update_title
    { name: "title", type: "string", description: "update_title: new design title" },
    // replace_text
    { name: "element", type: "string", description: "element_id from edit start" },
    { name: "text", type: "string", description: "replace_text: new text / find_and_replace_text: replacement" },
    // find_and_replace_text
    { name: "find", type: "string", description: "find_and_replace_text: text to find" },
    // update_fill / insert_fill
    { name: "asset", type: "string", description: "fills: asset id" },
    { name: "asset-type", type: "string", values: ["image", "video"], default: "image", description: "fills: asset type" },
    { name: "alt", type: "string", description: "fills: alt text (required by the server)" },
    { name: "page-id", type: "string", description: "insert_fill: page_id from edit start" },
    { name: "top", type: "string", description: "insert_fill/position_element: top (px)" },
    { name: "left", type: "string", description: "insert_fill/position_element: left (px)" },
    { name: "width", type: "string", description: "insert_fill/resize_element: width (px)" },
    { name: "height", type: "string", description: "insert_fill/resize_element: height (px)" },
    { name: "rotation", type: "string", description: "insert_fill: rotation (degrees)" },
    { name: "opacity", type: "string", description: "insert_fill: opacity" },
    // resize_element
    { name: "preserve-aspect-ratio", type: "boolean", description: "resize_element: keep aspect" },
    // format_text
    { name: "formatting", type: "string", description: "format_text: JSON formatting object" },
    // update_autofill_field
    { name: "field-label", type: "string", description: "update_autofill_field: new label" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const commitSpec: CommandArgsSpec = {
  command: "edit commit",
  args: [{ name: "txn-id", required: true, description: "transaction_id from edit start" }],
  flags: [
    { name: "confirm", type: "boolean", description: "required: persists the draft edits" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const cancelSpec: CommandArgsSpec = {
  command: "edit cancel",
  args: [{ name: "txn-id", required: true, description: "transaction_id from edit start" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

export const editHelp = [
  renderCommandHelp({
    spec: startSpec,
    summary:
      "Open a design for editing: returns transaction_id and editable element ids (draft until commit)",
    examples: ["canva-axi edit start DAFtmABcN3s"],
  }),
  renderCommandHelp({
    spec: performSpec,
    summary: "Apply one edit inside an open transaction (draft until commit)",
    examples: [
      'canva-axi edit perform TXN1 --page 1 --op replace_text --element EL1 --text "New headline"',
      'canva-axi edit perform TXN1 --page 1 --op find_and_replace_text --element EL1 --find old --text new',
      "canva-axi edit perform TXN1 --page 1 --op update_fill --element EL2 --asset A1 --alt \"Hero photo\"",
      'canva-axi edit perform TXN1 --page 1 --op update_title --title "New title"',
      "canva-axi edit perform TXN1 --page 1 --op delete_element --element EL3",
    ],
  }),
  renderCommandHelp({
    spec: commitSpec,
    summary: "Persist the transaction's draft edits to the design",
    examples: ["canva-axi edit commit TXN1 --confirm"],
  }),
  renderCommandHelp({
    spec: cancelSpec,
    summary: "Discard every draft edit in the transaction (the design stays unchanged)",
    examples: ["canva-axi edit cancel TXN1"],
  }),
  renderCommandHelp({
    command: "canva-axi edit thumbnail <txn-id> <page>",
    summary: "Get a page thumbnail inside an open editing transaction (signed; expires ~15 min)",
    examples: ["canva-axi edit thumbnail TXN1 2"],
  }),
].join("\n\n");

export async function editCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const sub = args[0];
  switch (sub) {
    case "start":
      return startSub(args.slice(1), deps);
    case "perform":
      return performSub(args.slice(1), deps);
    case "commit":
      return commitSub(args.slice(1), deps);
    case "cancel":
      return cancelSub(args.slice(1), deps);
    case "thumbnail":
      return thumbnailSub(args.slice(1), deps);
    case undefined:
      throw new AxiError("missing subcommand for 'edit'", "VALIDATION_ERROR", [
        "valid subcommands: start | perform | commit | cancel | thumbnail",
        "Run `canva-axi edit --help` for details",
      ]);
    default:
      throw new AxiError(`unknown edit subcommand '${sub}'`, "VALIDATION_ERROR", [
        "valid subcommands: start | perform | commit | cancel | thumbnail",
        "Run `canva-axi edit --help` for details",
      ]);
  }
}

async function startSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, startSpec);
  const api = deps.createApi();
  const ref = normalizeDesignId(parsed.positionals[0]!);
  const payload = await api.call("start-editing-transaction", { design_id: ref }, TIMEOUTS.fast);
  return emit(transactionView(payload, ref), jsonWanted(parsed));
}

interface PerformParsed {
  strings: Record<string, string>;
  booleans: Record<string, boolean>;
  positionals: string[];
}

function num(value: string | undefined, flag: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AxiError(`invalid --${flag} value '${value}'`, "VALIDATION_ERROR", [
      "use a number",
    ]);
  }
  return parsed;
}

function requireFlags(parsed: PerformParsed, names: string[], op: string): void {
  const missing = names.filter((name) => !parsed.strings[name]);
  if (missing.length) {
    throw new AxiError(`${op} requires --${missing.join(" and --")}`, "VALIDATION_ERROR", [
      `usage: --op ${op} --${missing[0]} <value>`,
      "element ids and page ids come from `canva-axi edit start`",
    ]);
  }
}

/** Build one operation object matching the live server schema. */
export function buildOperation(parsed: PerformParsed): Record<string, unknown> {
  const op = parsed.strings.op;
  if (!op) {
    throw new AxiError("edit perform requires --op", "VALIDATION_ERROR", [
      `valid values: ${OP_TYPES.join(" | ")}`,
      "element ids and page ids come from `canva-axi edit start`",
    ]);
  }
  switch (op) {
    case "update_title":
      requireFlags(parsed, ["title"], op);
      return { type: "update_title", title: parsed.strings.title };
    case "replace_text":
      requireFlags(parsed, ["element", "text"], op);
      return { type: "replace_text", element_id: parsed.strings.element, text: parsed.strings.text };
    case "find_and_replace_text":
      requireFlags(parsed, ["element", "find", "text"], op);
      return {
        type: "find_and_replace_text",
        element_id: parsed.strings.element,
        find_text: parsed.strings.find,
        replace_text: parsed.strings.text,
      };
    case "update_fill":
      requireFlags(parsed, ["element", "asset", "alt"], op);
      return {
        type: "update_fill",
        element_id: parsed.strings.element,
        asset_type: parsed.strings["asset-type"] ?? "image",
        asset_id: parsed.strings.asset,
        alt_text: parsed.strings.alt,
      };
    case "insert_fill": {
      requireFlags(parsed, ["asset", "alt"], op);
      const pageId = parsed.strings["page-id"];
      if (!pageId) {
        throw new AxiError("insert_fill requires --page-id (the page_id from edit start)", "VALIDATION_ERROR", [
          "page ids appear in the pages[] rows of `canva-axi edit start`",
        ]);
      }
      const optional = {
        top: num(parsed.strings.top, "top"),
        left: num(parsed.strings.left, "left"),
        width: num(parsed.strings.width, "width"),
        height: num(parsed.strings.height, "height"),
        rotation: num(parsed.strings.rotation, "rotation"),
        opacity: num(parsed.strings.opacity, "opacity"),
      };
      return {
        type: "insert_fill",
        page_id: pageId,
        asset_type: parsed.strings["asset-type"] ?? "image",
        asset_id: parsed.strings.asset,
        alt_text: parsed.strings.alt,
        ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
      };
    }
    case "delete_element":
      requireFlags(parsed, ["element"], op);
      return { type: "delete_element", element_id: parsed.strings.element };
    case "position_element": {
      requireFlags(parsed, ["element", "top", "left"], op);
      return {
        type: "position_element",
        element_id: parsed.strings.element,
        top: num(parsed.strings.top, "top"),
        left: num(parsed.strings.left, "left"),
      };
    }
    case "resize_element": {
      requireFlags(parsed, ["element"], op);
      return {
        type: "resize_element",
        element_id: parsed.strings.element,
        ...optionalOf(parsed, "width"),
        ...optionalOf(parsed, "height"),
        ...(parsed.booleans["preserve-aspect-ratio"] ? { preserve_aspect_ratio: true } : {}),
      };
    }
    case "format_text": {
      requireFlags(parsed, ["element", "formatting"], op);
      let formatting: unknown;
      try {
        formatting = JSON.parse(parsed.strings.formatting!);
      } catch {
        throw new AxiError("--formatting must be valid JSON", "VALIDATION_ERROR", [
          'example: --formatting \'{"bold":true}\'',
        ]);
      }
      return { type: "format_text", element_id: parsed.strings.element, formatting };
    }
    case "update_autofill_field":
      requireFlags(parsed, ["element", "field-label"], op);
      return {
        type: "update_autofill_field",
        element_id: parsed.strings.element,
        autofill_field_label: parsed.strings["field-label"],
      };
    default:
      throw new AxiError(`unknown --op '${op}'`, "VALIDATION_ERROR", [
        `valid values: ${OP_TYPES.join(" | ")}`,
        "check the live schema: canva-axi tools --schema perform-editing-operations",
      ]);
  }
}

function optionalOf(parsed: PerformParsed, flag: string): Record<string, number> {
  const value = num(parsed.strings[flag], flag);
  return value === undefined ? {} : { [flag]: value };
}

async function performSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, performSpec);
  const operation = buildOperation(parsed);
  const page = Number(parsed.strings.page ?? "1");
  if (!Number.isInteger(page) || page < 1) {
    throw new AxiError(`invalid --page '${parsed.strings.page}'`, "VALIDATION_ERROR", [
      "use a 1-based page index",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "perform-editing-operations",
    {
      transaction_id: parsed.positionals[0]!,
      page_index: page,
      operations: [operation],
    },
    TIMEOUTS.fast,
  );
  const view = performResultView(payload);
  view.help = [
    "apply more edits with another canva-axi edit perform",
    "save everything: canva-axi edit commit <txn-id> --confirm",
    "discard: canva-axi edit cancel <txn-id>",
  ];
  return emit(view, jsonWanted(parsed));
}

async function commitSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, commitSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("edit commit persists edits to the design and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi edit commit <txn-id> --confirm",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "commit-editing-transaction",
    { transaction_id: parsed.positionals[0]! },
    TIMEOUTS.fast,
  );
  const transaction = (payload.transaction ?? {}) as Record<string, unknown>;
  return emit(
    {
      transaction: {
        id: String(transaction.id ?? parsed.positionals[0]!),
        status: String(transaction.status ?? "committed"),
      },
      help: [
        "edits are saved — verify: canva-axi design content <id>",
        "export the result: canva-axi export <id> --format png",
      ],
    },
    jsonWanted(parsed),
  );
}

async function cancelSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, cancelSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "cancel-editing-transaction",
    { transaction_id: parsed.positionals[0]! },
    TIMEOUTS.fast,
  );
  const transaction = (payload.transaction ?? {}) as Record<string, unknown>;
  return emit(
    {
      transaction: {
        id: String(transaction.id ?? parsed.positionals[0]!),
        status: String(transaction.status ?? "cancelled"),
      },
      help: [
        "draft edits were discarded and can't be recovered — the design is unchanged",
        "start a fresh transaction: canva-axi edit start <design-id>",
      ],
    },
    jsonWanted(parsed),
  );
}
