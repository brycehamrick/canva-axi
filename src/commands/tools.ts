import { AxiError } from "axi-sdk-js";
import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import type { CanvaApi } from "../canva/client.js";
import { emit, jsonWanted, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";

/**
 * Introspection of the live server: the tool catalog and input schemas.
 *
 * The CLI hardcodes command surfaces, but the server owns the schemas; when
 * a call fails on arguments, `tools --schema <name>` shows the live input
 * schema so an agent self-corrects without guessing (AXI principle 9).
 */

const spec: CommandArgsSpec = {
  command: "tools",
  flags: [
    { name: "schema", type: "string", description: "show the live input schema for one tool" },
    { name: "json", type: "boolean", description: "emit JSON instead of TOON" },
  ],
};

export const toolsHelp = renderCommandHelp({
  spec,
  summary: "List the Canva MCP server's tools, or show one tool's live input schema",
  examples: ["canva-axi tools", "canva-axi tools --schema generate-design"],
});

export async function toolsCommand(args: string[], api: CanvaApi): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, spec);

  if (parsed.strings.schema) {
    const name = parsed.strings.schema;
    const tools = await api.listTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      throw new AxiError(`tool '${name}' is not exposed by the Canva MCP server`, "NOT_FOUND", [
        "run `canva-axi tools` for the catalog",
      ]);
    }
    return emit({ tool: name, input_schema: tool.inputSchema }, jsonWanted(parsed));
  }

  const tools = await api.listTools();
  const rows = tools.map((tool) => ({
    name: tool.name,
    description: tool.description.split(/[.\n]/)[0] ?? "",
  }));
  const out: Record<string, unknown> = { count: rows.length };
  out.tools = rows.length === 0 ? "none — the server exposed no tools" : rows;
  out.help = ["inspect one schema: canva-axi tools --schema <name>"];
  return emit(out, jsonWanted(parsed));
}
