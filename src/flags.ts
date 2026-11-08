import { AxiError } from "axi-sdk-js";

/**
 * Declarative, fail-loud argument parsing for canva-axi commands.
 *
 * AXI principle 6: unknown flags are rejected by name with the valid flag
 * list inlined so an agent self-corrects in one turn. `--help` is handled
 * upstream by the SDK before command handlers run.
 */

export type FlagType = "string" | "boolean" | "repeat";

export interface FlagDef {
  name: string;
  type: FlagType;
  description: string;
  /** Restrict string/repeat values to a fixed set. */
  values?: readonly string[];
  /** Default value shown in help; strings default to undefined unless set. */
  default?: string;
}

export interface ParsedCommand {
  positionals: string[];
  strings: Record<string, string>;
  booleans: Record<string, boolean>;
  repeats: Record<string, string[]>;
}

export interface ArgSpec {
  name: string;
  required: boolean;
  description: string;
}

export interface CommandArgsSpec {
  command: string;
  flags: FlagDef[];
  args?: ArgSpec[];
}

function validFlagsLine(spec: CommandArgsSpec): string {
  const names = [...spec.flags.map((flag) => `--${flag.name}`), "--help"];
  return `valid flags for '${spec.command}': ${names.join(", ")}`;
}

export function flagDefaults(spec: CommandArgsSpec): ParsedCommand {
  const parsed: ParsedCommand = {
    positionals: [],
    strings: {},
    booleans: {},
    repeats: {},
  };
  for (const flag of spec.flags) {
    if (flag.default !== undefined) {
      if (flag.type === "boolean") parsed.booleans[flag.name] = flag.default === "true";
      else if (flag.type === "repeat") parsed.repeats[flag.name] = [flag.default];
      else parsed.strings[flag.name] = flag.default;
    } else if (flag.type === "repeat") {
      parsed.repeats[flag.name] = [];
    }
  }
  return parsed;
}

export function parseCommandArgs(argv: string[], spec: CommandArgsSpec): ParsedCommand {
  const parsed = flagDefaults(spec);
  const args = spec.args ?? [];
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("--")) {
      let name = token.slice(2);
      let inline: string | undefined;
      const equals = name.indexOf("=");
      if (equals >= 0) {
        inline = name.slice(equals + 1);
        name = name.slice(0, equals);
      }
      const flag = spec.flags.find((candidate) => candidate.name === name);
      if (!flag) {
        throw new AxiError(`unknown flag --${name} for '${spec.command}'`, "VALIDATION_ERROR", [
          validFlagsLine(spec),
          `Run \`canva-axi ${spec.command} --help\` for details`,
        ]);
      }
      if (flag.type === "boolean") {
        if (inline !== undefined) {
          throw new AxiError(`flag --${name} does not take a value`, "VALIDATION_ERROR", [
            `use --${name} alone`,
            validFlagsLine(spec),
          ]);
        }
        parsed.booleans[flag.name] = true;
        continue;
      }
      let value = inline;
      if (value === undefined) {
        value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new AxiError(`flag --${name} requires a value`, "VALIDATION_ERROR", [
            `usage: --${name} <${flag.values ? flag.values.join("|") : "value"}>`,
          ]);
        }
        index++;
      }
      if (flag.values && !flag.values.includes(value)) {
        throw new AxiError(`invalid value '${value}' for --${name}`, "VALIDATION_ERROR", [
          `valid values: ${flag.values.join(", ")}`,
        ]);
      }      if (flag.type === "repeat") parsed.repeats[flag.name]!.push(value);
      else parsed.strings[flag.name] = value;
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      throw new AxiError(`unknown flag ${token}`, "VALIDATION_ERROR", [
        "short flags are not supported",
        validFlagsLine(spec),
      ]);
    }
    positionals.push(token);
  }

  const required = args.filter((arg) => arg.required);
  if (positionals.length < required.length) {
    const missing = required[positionals.length]!;
    throw new AxiError(`missing required argument <${missing.name}>`, "VALIDATION_ERROR", [
      `usage: canva-axi ${spec.command} <${missing.name}> [flags]`,
      `Run \`canva-axi ${spec.command} --help\` for details`,
    ]);
  }
  if (positionals.length > args.length) {
    throw new AxiError(
      `unexpected argument '${positionals[args.length]}'`,
      "VALIDATION_ERROR",
      [`usage: canva-axi ${spec.command} ${args.map((arg) => `<${arg.name}>`).join(" ")}`],
    );
  }

  parsed.positionals = positionals;
  return parsed;
}

/** Build the TOON help block for a command's flags. */
export function flagHelpRows(spec: CommandArgsSpec): Array<Record<string, string>> {
  return spec.flags.map((flag) => ({
    flag: `--${flag.name}${flag.type === "repeat" ? " (repeatable)" : ""}`,
    default: flag.default ?? "",
    description: flag.values
      ? `${flag.description} (${flag.values.join("|")})`
      : flag.description,
  }));
}
