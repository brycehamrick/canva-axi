import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, normalizeDesignId, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";
import { commentsView, repliesView, commentCreatedView } from "../render.js";

/**
 * Comments: list threads, list replies, add, reply. add and reply are
 * visible to collaborators → --confirm gated.
 */

const listSpec: CommandArgsSpec = {
  command: "comment ls",
  args: [{ name: "ref", required: true, description: "design id (D…) or full canva.com share URL" }],
  flags: [
    { name: "limit", type: "string", description: "page size 1-100 (server default 50)" },
    { name: "continuation", type: "string", description: "pagination token from a previous page" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const repliesSpec: CommandArgsSpec = {
  command: "comment replies",
  args: [
    { name: "ref", required: true, description: "design id (D…) or share URL" },
    { name: "comment-id", required: true, description: "thread id from comment ls" },
  ],
  flags: [
    { name: "limit", type: "string", description: "page size 1-100 (server default 50)" },
    { name: "continuation", type: "string", description: "pagination token from a previous page" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const addSpec: CommandArgsSpec = {
  command: "comment add",
  args: [{ name: "ref", required: true, description: "design id (D…) or share URL" }],
  flags: [
    { name: "message", type: "string", description: "comment text (1-1000 chars)" },
    { name: "confirm", type: "boolean", description: "required: visible to everyone with design access" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

const replySpec: CommandArgsSpec = {
  command: "comment reply",
  args: [
    { name: "ref", required: true, description: "design id (D…) or share URL" },
    { name: "comment-id", required: true, description: "thread id to reply to" },
  ],
  flags: [
    { name: "message", type: "string", description: "reply text (1-2048 chars)" },
    { name: "confirm", type: "boolean", description: "required: visible to everyone with design access" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

export const commentHelp = [
  renderCommandHelp({
    spec: listSpec,
    summary: "List comment threads on a design",
    examples: ["canva-axi comment ls DAFtmABcN3s"],
  }),
  renderCommandHelp({
    spec: repliesSpec,
    summary: "Read the replies inside one thread",
    examples: ["canva-axi comment replies DAFtmABcN3s COMMENT123"],
  }),
  renderCommandHelp({
    spec: addSpec,
    summary: "Add a new comment thread to a design",
    examples: ['canva-axi comment add DAFtmABcN3s --message "Check the pricing slide" --confirm'],
  }),
  renderCommandHelp({
    spec: replySpec,
    summary: "Reply inside an existing comment thread",
    examples: ['canva-axi comment reply DAFtmABcN3s COMMENT123 --message "Updated" --confirm'],
  }),
].join("\n\n");

export async function commentCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const sub = args[0];
  switch (sub) {
    case "ls":
      return lsSub(args.slice(1), deps);
    case "replies":
      return repliesSub(args.slice(1), deps);
    case "add":
      return addSub(args.slice(1), deps);
    case "reply":
      return replySub(args.slice(1), deps);
    case undefined:
      throw new AxiError("missing subcommand for 'comment'", "VALIDATION_ERROR", [
        "valid subcommands: ls | replies | add | reply",
        "Run `canva-axi comment --help` for details",
      ]);
    default:
      throw new AxiError(`unknown comment subcommand '${sub}'`, "VALIDATION_ERROR", [
        "valid subcommands: ls | replies | add | reply",
        "Run `canva-axi comment --help` for details",
      ]);
  }
}

function limitArg(parsed: ReturnType<typeof parseCommandArgs>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (parsed.strings.limit) {
    const limit = Number(parsed.strings.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AxiError(`invalid --limit '${parsed.strings.limit}'`, "VALIDATION_ERROR", [
        "use an integer between 1 and 100",
      ]);
    }
    out.limit = limit;
  }
  if (parsed.strings.continuation) out.continuation = parsed.strings.continuation;
  return out;
}

async function lsSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, listSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "list-comments",
    { design_id: normalizeDesignId(parsed.positionals[0]!), ...limitArg(parsed) },
    TIMEOUTS.fast,
  );
  return emit(commentsView(payload), jsonWanted(parsed));
}

async function repliesSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, repliesSpec);
  const api = deps.createApi();
  const payload = await api.call(
    "list-replies",
    {
      design_id: normalizeDesignId(parsed.positionals[0]!),
      comment_id: parsed.positionals[1]!,
      ...limitArg(parsed),
    },
    TIMEOUTS.fast,
  );
  return emit(repliesView(payload), jsonWanted(parsed));
}

async function addSub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, addSpec);
  const message = parsed.strings.message;
  if (!message) {
    throw new AxiError("comment add requires --message", "VALIDATION_ERROR", [
      'example: canva-axi comment add <id> --message "..." --confirm',
    ]);
  }
  if (message.length > 1000) {
    throw new AxiError(`message is ${message.length} chars; comment add allows 1-1000`, "VALIDATION_ERROR", [
      "shorten the comment, or use comment reply (2048 chars) for long text",
    ]);
  }
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("comment add is visible to everyone with design access and requires --confirm", "VALIDATION_ERROR", [
      're-run with --confirm: canva-axi comment add <id> --message "..." --confirm',
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "comment-on-design",
    { design_id: normalizeDesignId(parsed.positionals[0]!), message_plaintext: message },
    TIMEOUTS.fast,
  );
  return emit(commentCreatedView(payload, false), jsonWanted(parsed));
}

async function replySub(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, replySpec);
  const message = parsed.strings.message;
  if (!message) {
    throw new AxiError("comment reply requires --message", "VALIDATION_ERROR", [
      'example: canva-axi comment reply <id> <comment-id> --message "..." --confirm',
    ]);
  }
  if (message.length > 2048) {
    throw new AxiError(`message is ${message.length} chars; comment reply allows 1-2048`, "VALIDATION_ERROR", [
      "shorten the reply",
    ]);
  }
  if (parsed.booleans.confirm !== true) {
    throw new AxiError("comment reply is visible to everyone with design access and requires --confirm", "VALIDATION_ERROR", [
      're-run with --confirm: canva-axi comment reply <id> <comment-id> --message "..." --confirm',
    ]);
  }
  const api = deps.createApi();
  const payload = await api.call(
    "reply-to-comment",
    {
      design_id: normalizeDesignId(parsed.positionals[0]!),
      comment_id: parsed.positionals[1]!,
      message_plaintext: message,
    },
    TIMEOUTS.fast,
  );
  return emit(commentCreatedView(payload, true), jsonWanted(parsed));
}
