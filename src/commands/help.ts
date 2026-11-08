import { parseCommandArgs, type CommandArgsSpec } from "../flags.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import { emit, jsonWanted, type CommandOutput } from "./shared.js";
import { renderCommandHelp } from "../help.js";

/** `help` — ask the Canva Help Center through the MCP help tool. */

const spec: CommandArgsSpec = {
  command: "help",
  args: [{ name: "question", required: true, description: "Canva product question, in the user's words" }],
  flags: [{ name: "json", type: "boolean", description: "emit JSON instead of TOON" }],
};

export const helpCommandHelp = renderCommandHelp({
  spec,
  summary: "Answer a Canva product question from the official Canva Help Center",
  examples: ['canva-axi help "How do I add page numbers to my presentation?"'],
});

export async function helpCommand(args: string[], deps: { createApi: typeof createCanvaApi }): Promise<CommandOutput> {
  const parsed = parseCommandArgs(args, spec);
  const api = deps.createApi();
  const payload = await api.call(
    "help",
    { prompt: parsed.positionals[0]! },
    TIMEOUTS.job,
  );
  const job = (payload.job ?? {}) as Record<string, unknown>;
  const result = (job.result ?? {}) as Record<string, unknown>;
  const answer = typeof result.answer === "string" ? result.answer : "";
  const out: Record<string, unknown> = {
    answer: answer || "(no answer returned)",
    help: ["show the answer as written — it's generated from the official Canva Help Center"],
  };
  return emit(out, jsonWanted(parsed));
}
