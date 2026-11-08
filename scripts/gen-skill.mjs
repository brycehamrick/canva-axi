// Generates skills/canva-axi/SKILL.md from the built CLI content module so
// the skill never drifts from the CLI's own guidance. Run `npm run build`
// first (npm run skill:gen does both). `--check` exits 1 on drift.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESCRIPTION,
  COMMAND_SUMMARIES,
  USAGE_NOTES,
  topLevelHelpText,
} from "../dist/skill.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "skills", "canva-axi", "SKILL.md");

const frontmatter = [
  "---",
  "name: canva-axi",
  `description: "${DESCRIPTION.replace(/"/g, '\\"')} — search, create, edit, autofill, comment on, and export Canva designs. Use when a task mentions Canva, canva.com designs, brand templates, or design exports for the user's Canva account."`,
  "---",
].join("\n");

const lines = [
  "# canva-axi",
  "",
  `${DESCRIPTION}. Agent-ergonomic CLI built to the AXI spec (TOON output, structured errors, contextual next steps), wrapping Canva's remote MCP server (https://mcp.canva.com/mcp).`,
  "",
  "Works without a global install via `npx -y canva-axi <command>`; with a global install, drop the `npx -y` prefix.",
  "",
  "```",
  topLevelHelpText(),
  "```",
  "",
  `usage[${USAGE_NOTES.length}]:`,
  ...USAGE_NOTES.map((note) => ` ${note}`),
  "",
  `commands[${COMMAND_SUMMARIES.length}]{command,summary}:`,
  ...COMMAND_SUMMARIES.map((entry) => ` ${entry.command},${entry.summary}`),
  "",
  "Every command supports `--help`. Common flow: `auth login` once, `design search` to find work, `edit start → edit perform → edit commit --confirm` to change it, `export --format png` to ship it.",
  "",
].join("\n");

const content = `${frontmatter}\n\n${lines}`;

if (process.argv.includes("--check")) {
  const existing = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (existing !== content) {
    console.error(
      "skills/canva-axi/SKILL.md is stale. Run `npm run skill:gen` and commit the result.",
    );
    process.exit(1);
  }
  console.log("skills/canva-axi/SKILL.md is up to date.");
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  console.log(`wrote ${target}`);
}
