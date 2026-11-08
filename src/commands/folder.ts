import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS, DEFAULT_LIMIT } from "../canva/client.js";
import { emit, jsonWanted, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { foldersView, folderItemsView, moveView } from "../render.js";
import { clampLimit } from "./design.js";

/**
 * Folder tree: search/ls/create/move. create and move mutate → --confirm.
 */

const searchSpec: CommandArgsSpec = {
  command: "folder search",
  args: [{ name: "query", required: false, description: "match folder names and tags (omit to browse all)" }],
  flags: [
    { name: "limit", type: "string", default: String(DEFAULT_LIMIT), description: "max results (1-100)" },
    {
      name: "ownership",
      type: "string",
      values: ["any", "owned", "shared"],
      description: "whose folders (omit = any)",
    },
    { name: "continuation", type: "string", description: "pagination token from a previous page" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const lsSpec: CommandArgsSpec = {
  command: "folder ls",
  args: [{ name: "folder-id", required: true, description: "folder id, or \"root\" for the top level" }],
  flags: [
    { name: "type", type: "string", values: ["design", "folder", "image"], description: "filter to one item type" },
    { name: "sort", type: "string", description: "e.g. modified_descending (see tool schema)" },
    { name: "continuation", type: "string", description: "pagination token from a previous page" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const createSpec: CommandArgsSpec = {
  command: "folder create",
  args: [],
  flags: [
    { name: "name", type: "string", description: "new folder name" },
    { name: "parent", type: "string", default: "root", description: "parent folder id (default root)" },
    { name: "confirm", type: "boolean", description: "required: creates a folder in your account" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const moveSpec: CommandArgsSpec = {
  command: "folder move",
  args: [
    { name: "item-id", required: true, description: "design, folder, or image id to move" },
    { name: "to-folder-id", required: true, description: "destination folder id, or \"root\"" },
  ],
  flags: [
    { name: "confirm", type: "boolean", description: "required: changes where the item lives" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

export const folderHelp = [
  renderCommandHelp({
    spec: searchSpec,
    summary: "Find folders by name or tag, or browse all folders",
    examples: ["canva-axi folder search rebrand", "canva-axi folder search"],
  }),
  renderCommandHelp({
    spec: lsSpec,
    summary: "List designs, folders, and images inside one folder",
    examples: ["canva-axi folder ls root", "canva-axi folder ls FOLDER123 --type design --sort modified_descending"],
  }),
  renderCommandHelp({
    spec: createSpec,
    summary: "Create a folder or subfolder",
    examples: ['canva-axi folder create --name "Q3 campaign" --parent root --confirm'],
  }),
  renderCommandHelp({
    spec: moveSpec,
    summary: "Move a design, folder, or image into a folder (items in multiple folders error)",
    examples: ["canva-axi folder move DAFtmABcN3s FOLDER123 --confirm"],
  }),
].join("\n\n");

export async function folderCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const sub = args[0];
  switch (sub) {
    case "search":
      return searchSub(args.slice(1), deps);
    case "ls":
      return lsSub(args.slice(1), deps);
    case "create":
      return createSub(args.slice(1), deps);
    case "move":
      return moveSub(args.slice(1), deps);
    case undefined:
      if (args.length === 0) return searchSub([], deps);
      throw new AxiError("missing subcommand for 'folder'", "VALIDATION_ERROR", [
        "valid subcommands: search | ls | create | move",
        "Run `canva-axi folder --help` for details",
      ]);
    default:
      throw new AxiError(`unknown folder subcommand '${sub}'`, "VALIDATION_ERROR", [
        "valid subcommands: search | ls | create | move",
        "Run `canva-axi folder --help` for details",
      ]);
  }
}

async function searchSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, searchSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "search-folders",
    {
      ...(parsed.positionals[0] ? { query: parsed.positionals[0] } : {}),
      limit: clampLimit(parsed.strings.limit, "folder search"),
      ...(parsed.strings.ownership ? { ownership: parsed.strings.ownership } : {}),
      ...(parsed.strings.continuation ? { continuation: parsed.strings.continuation } : {}),
    },
    TIMEOUTS.fast,
  );
  return emit(foldersView(payload), jsonWanted(parsed));
}

async function lsSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, lsSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "list-folder-items",
    {
      folder_id: parsed.positionals[0]!,
      ...(parsed.strings.type ? { item_types: [parsed.strings.type] } : {}),
      ...(parsed.strings.sort ? { sort_by: parsed.strings.sort } : {}),
      ...(parsed.strings.continuation ? { continuation: parsed.strings.continuation } : {}),
    },
    TIMEOUTS.fast,
  );
  return emit(folderItemsView(payload), jsonWanted(parsed));
}

async function createSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, createSpec);
  if (!parsed.strings.name) {
    throw new AxiError("folder create requires --name", "VALIDATION_ERROR", [
      'example: canva-axi folder create --name "Q4 campaign" --confirm',
    ]);
  }
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("folder create adds a folder to your account and requires --confirm", "VALIDATION_ERROR", [
      're-run with --confirm: canva-axi folder create --name "..." --confirm',
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "create-folder",
    { name: parsed.strings.name, parent_folder_id: parsed.strings.parent ?? "root" },
    TIMEOUTS.fast,
  );
  const folder = (payload.folder ?? {}) as Record<string, unknown>;
  return emit(
    {
      folder: {
        id: String(folder.id ?? ""),
        name: String(folder.name ?? ""),
        ...(folder.folder_url ? { url: String(folder.folder_url) } : {}),
      },
      help: ["move items in: canva-axi folder move <item-id> <folder-id> --confirm"],
    },
    jsonWanted(parsed),
  );
}

async function moveSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, moveSpec);
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("folder move changes an item's location and requires --confirm", "VALIDATION_ERROR", [
      "re-run with --confirm: canva-axi folder move <item-id> <to-folder-id> --confirm",
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "move-item-to-folder",
    { item_id: parsed.positionals[0]!, to_folder_id: parsed.positionals[1]! },
    TIMEOUTS.fast,
  );
  const view = moveView(payload);
  view.help = [
    "an item in more than one folder can't be moved by this tool (item_in_multiple_folders) — the user must move it in Canva",
    "browse the destination: canva-axi folder ls <folder-id>",
  ];
  return emit(view, jsonWanted(parsed));
}
