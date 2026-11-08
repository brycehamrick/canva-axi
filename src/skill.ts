/**
 * Single source of truth for guidance text: the no-args home view, the
 * top-level help, and the generated SKILL.md all derive from here so the
 * skill never drifts from the CLI (AXI principle 7).
 */

export const DESCRIPTION =
  "Create and manage Canva designs from the shell over the official Canva MCP server";

export interface CommandSummary {
  command: string;
  summary: string;
}

export const COMMAND_SUMMARIES: CommandSummary[] = [
  { command: "(none)", summary: "home: connection state + recent designs" },
  { command: "auth login", summary: "Connect your Canva account (one-time browser approval)" },
  { command: "auth status", summary: "Show connection state and token source (--probe verifies live)" },
  { command: "auth logout", summary: "Revoke stored tokens and remove the local credential file" },
  { command: "design search [query]", summary: "Find designs in your library by title keyword" },
  { command: "design get <ref>", summary: "One design: title, owner, URLs, page count, timestamps" },
  { command: "design content <ref>", summary: "Read a design's text (read-only; --full for everything)" },
  { command: "design pages <ref>", summary: "Pages with dimensions" },
  { command: "design notes <ref>", summary: "Presenter notes of a presentation (--full)" },
  { command: "design job <job-id>", summary: "Poll a design-creation or layers job (--token, --kind layers)" },
  { command: "design create <brief>", summary: "New editable design from a brief --confirm (polls to done)" },
  { command: "design copy <ref>", summary: "Duplicate a design (--pages subset) --confirm" },
  { command: "design resize <ref>", summary: "Resized copy (--preset | --width/--height) --confirm (Pro)" },
  { command: "design merge <ref>", summary: "Insert/move/delete pages (one op per call) --confirm" },
  { command: "design import <url> <name>", summary: "PDF/deck/doc/web page → new design --confirm" },
  { command: "generate <query> --type <t>", summary: "Design candidates from a query --confirm (AI credits; 25 types)" },
  { command: "generate pick <job> <candidate>", summary: "Turn the chosen candidate into a real design" },
  { command: "generate image <prompt>", summary: "Standalone image, or edit --ref images --confirm (AI credits)" },
  { command: "generate image-job <job-id>", summary: "Poll an image generation job" },
  { command: "image layers <asset>", summary: "Flat image → editable design --confirm" },
  { command: "image remove-bg <media>", summary: "Background-removed copy of an image --confirm" },
  { command: "image assets <ids>", summary: "Look up image/video assets by id" },
  { command: "image upload-url <url>", summary: "Import a public HTTPS file --confirm" },
  { command: "image upload <path>", summary: "Upload a local file (create-upload-url + POST) --confirm" },
  { command: "edit start <ref>", summary: "Open for editing: transaction_id + element/page ids (draft)" },
  { command: "edit perform <txn>", summary: "Apply one of 10 ops: update_title, replace_text, find_and_replace_text, update_fill, insert_fill, delete_element, position_element, resize_element, format_text, update_autofill_field" },
  { command: "edit commit <txn>", summary: "Persist draft edits --confirm" },
  { command: "edit cancel <txn>", summary: "Discard draft edits" },
  { command: "edit thumbnail <txn> <page>", summary: "Page thumbnail inside a transaction (signed, ~15 min)" },
  { command: "folder search [query]", summary: "Find folders by name/tag, or browse all" },
  { command: "folder ls <id>", summary: "Designs/folders/images inside one folder (root = top level)" },
  { command: "folder create", summary: "--name --parent --confirm" },
  { command: "folder move <item> <to>", summary: "Move an item into a folder --confirm" },
  { command: "comment ls <ref>", summary: "Comment threads on a design" },
  { command: "comment replies <ref> <id>", summary: "Replies inside one thread" },
  { command: "comment add <ref>", summary: "--message (1-1000 chars) --confirm" },
  { command: "comment reply <ref> <id>", summary: "--message (1-2048 chars) --confirm" },
  { command: "template kits", summary: "Brand Kits (Pro)" },
  { command: "template search [query]", summary: "Brand Templates by title / --brand-kit (Pro)" },
  { command: "template dataset <id>", summary: "Autofill fields of a Brand Template" },
  { command: "template create <id>", summary: "New design from a Brand Template --confirm" },
  { command: "template draft <id>", summary: "Editable draft of a template --confirm" },
  { command: "template publish <ref>", summary: "Publish a draft back as the template --confirm" },
  { command: "autofill", summary: "--template|--design + --data JSON --confirm (Pro)" },
  { command: "autofill fields <ref>", summary: "Autofill fields of an existing design" },
  { command: "export formats <ref>", summary: "Formats + pages a design can export" },
  { command: "export <ref>", summary: "--format pdf|png|jpg|pptx|… (render-only; URLs expire fast)" },
  { command: "shortlink <link>", summary: "Expand a canva.link shortlink" },
  { command: "help <question>", summary: "Answer a Canva product question from the Help Center" },
  { command: "tools", summary: "Live server tool catalog; --schema <name> for input schemas" },
  { command: "setup hooks", summary: "Install session-start ambient context for Claude Code, Codex, OpenCode" },
  { command: "update", summary: "Upgrade canva-axi to the latest published npm version (built-in)" },
];

export function topLevelHelpText(): string {
  const lines = [
    `canva-axi: ${DESCRIPTION}`,
    `commands[${COMMAND_SUMMARIES.length}]{command,summary}:`,
  ];
  for (const entry of COMMAND_SUMMARIES) {
    lines.push(` ${entry.command},${entry.summary}`);
  }
  lines.push(`flags[4]{flag,description}:`);
  lines.push(" --help,show command help");
  lines.push(" --version,print the version (fast path)");
  lines.push(" --json,emit JSON instead of TOON (data commands)");
  lines.push(" --confirm,required gate on persisting writes and AI-credit tools");
  lines.push(`examples[4]:`);
  lines.push(" canva-axi");
  lines.push(' canva-axi design search "launch deck"');
  lines.push(" canva-axi design create \"5-slide deck introducing our product\"");
  lines.push(' canva-axi export DAFtmABcN3s --format pdf');
  return lines.join("\n");
}

/** Static guidance shared by the skill and README. */
export const USAGE_NOTES: string[] = [
  "Runs `canva-axi auth login` once (opens a browser, approves all scopes); every later command is headless with silent token refresh. For CI/headless use, export CANVA_ACCESS_TOKEN.",
  "Design refs accept the 11-char design id (D…) or a full canva.com share URL; shortlinks resolve first via `canva-axi shortlink`.",
  "Reads, job polls, exports (render-only), and the draft half of editing (start/perform/cancel) are ungated. Everything that persists to the account or consumes AI credits refuses to run without --confirm (exit 2): design create/copy/resize/merge/import, generate + generate image, image layers/remove-bg/upload-url/upload, folder create/move, comment add/reply, template create/draft/publish, autofill.",
  "The editing flow is a transaction: `edit start` (draft) → `edit perform` (draft ops; nothing persists) → `edit commit --confirm` (persist) or `edit cancel` (discard). Commit can fail on concurrent edits — cancel, start fresh, re-apply.",
  "Job flows: `design create` and `image layers` poll automatically (use --wait false to detach); `generate image` returns a jobId you poll with `generate image-job`. Respect wait_seconds; polling early returns polled_too_early.",
  "Exports are render-only and ungated, but signed download URLs expire quickly — download immediately.",
  "Pro-plan surfaces (brand kits/templates, autofill, resize) return empty results on Free plans instead of erroring; treat empty as definitive.",
  "get-assets returns one content block per requested id; failed lookups appear as per-id errors, not command failures.",
  "Exit codes: 0 success (including no-ops), 1 runtime/API error, 2 usage/validation (missing --confirm, unknown flags). Errors are structured on stdout with help[] next steps.",
  "`canva-axi tools --schema <tool>` prints the live server input schema when a call rejects your arguments — self-correct without guessing.",
  "Thumbnails and export URLs are signed and expire (~15 min): use immediately, never store or share.",
];
