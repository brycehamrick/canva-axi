import type { CommandArgsSpec } from "./flags.js";
import { flagHelpRows } from "./flags.js";

/** Renders concise per-command --help text (AXI principle 10). */

export interface CommandHelpInput {
  spec?: CommandArgsSpec;
  /** Manual usage line when no spec applies (rare). */
  command?: string;
  summary: string;
  examples: string[];
}

function argsDisplay(spec: CommandArgsSpec): string {
  return (spec.args ?? [])
    .map((arg) => (arg.required ? `<${arg.name}>` : `[<${arg.name}>]`))
    .join(" ");
}

export function renderCommandHelp(input: CommandHelpInput): string {
  const { summary, examples } = input;
  const usage = input.spec
    ? `canva-axi ${input.spec.command}${argsDisplay(input.spec) ? ` ${argsDisplay(input.spec)}` : ""}`
    : (input.command ?? "canva-axi");
  const lines: string[] = [
    `command: ${usage}`,
    `summary: ${summary}`,
  ];
  const spec = input.spec;
  if (spec?.args?.length) {
    lines.push(`args[${spec.args.length}]{name,required,description}:`);
    for (const arg of spec.args) {
      lines.push(` ${arg.name},${arg.required ? "yes" : "no"},${arg.description}`);
    }
  }
  const rows = spec
    ? [...flagHelpRows(spec), { flag: "--help", default: "", description: "show this help" }]
    : [
        { flag: "--json", default: "", description: "emit JSON instead of TOON" },
        { flag: "--help", default: "", description: "show this help" },
      ];
  lines.push(`flags[${rows.length}]{flag,default,description}:`);
  for (const row of rows) {
    lines.push(` ${row.flag},${row.default},${row.description}`);
  }
  lines.push(`examples[${examples.length}]:`);
  for (const example of examples) {
    lines.push(` ${example}`);
  }
  return lines.join("\n");
}
