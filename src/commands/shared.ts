import { AxiError } from "axi-sdk-js";
import type { ParsedCommand } from "../flags.js";
import type { CanvaApi } from "../canva/client.js";

/** Result a command handler returns (SDK serializes objects to TOON). */
export type CommandOutput = Record<string, unknown> | string;

export function emit(data: Record<string, unknown>, json: boolean): CommandOutput {
  return json ? `${JSON.stringify(data, null, 2)}` : data;
}

export function jsonWanted(parsed: ParsedCommand): boolean {
  return parsed.booleans.json === true;
}

/**
 * Safety gate for persisting mutations. Fails before any network access so
 * a forgotten --confirm never touches the user's Canva data.
 */
export function requireConfirm(parsed: ParsedCommand, command: string): void {
  if (parsed.booleans.confirm !== true) {
    throw new AxiError(
      `${command} changes your Canva data and requires --confirm`,
      "VALIDATION_ERROR",
      [
        `re-run with --confirm: canva-axi ${command}`,
        "preview what changes in the error above, then confirm deliberately",
      ],
    );
  }
}

/** Design IDs are 11 chars starting with D (e.g. DAFtmABcN3s); also accept share URLs. */
const DESIGN_URL = /canva\.com\/.*?(D[A-Za-z0-9_-]{10,})/;

export function normalizeDesignId(ref: string): string {
  const urlMatch = DESIGN_URL.exec(ref);
  if (urlMatch) return urlMatch[1]!;
  return ref;
}

export function helpLines(...lines: string[]): string[] {
  return lines;
}
