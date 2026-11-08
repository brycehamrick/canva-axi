import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Local credential store for canva-axi.
 *
 * Stores the OAuth client/token set under `$XDG_CONFIG_HOME/canva-axi/config.json`
 * (default `~/.config/canva-axi/`) with 0600 permissions. Tokens are never
 * printed by any command.
 *
 * `CANVA_ACCESS_TOKEN` in the environment takes precedence over stored tokens
 * for headless/CI use where a token was obtained out of band.
 */

export interface CanvaTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  /** OAuth client_id from dynamic registration; needed for refresh grants. */
  client_id?: string;
  registered_at?: number;
}

export interface CanvaConfig {
  tokens?: CanvaTokenSet;
}

export const ENV_TOKEN_VAR = "CANVA_ACCESS_TOKEN";

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "canva-axi");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function readConfig(): CanvaConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as CanvaConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeConfig(config: CanvaConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = configPath();
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, target);
}

export function updateConfig(patch: (current: CanvaConfig) => CanvaConfig): CanvaConfig {
  const next = patch(readConfig());
  writeConfig(next);
  return next;
}

/** Remove the config file. Returns true when a file existed and was deleted. */
export function deleteConfig(): boolean {
  if (!existsSync(configPath())) return false;
  try {
    rmSync(configPath());
    return true;
  } catch {
    return false;
  }
}

export function envAccessToken(): string | undefined {
  const value = process.env[ENV_TOKEN_VAR]?.trim();
  return value || undefined;
}

export type TokenSource = "env" | "stored" | "none";

export function tokenSource(): TokenSource {
  if (envAccessToken()) return "env";
  if (readConfig().tokens?.access_token) return "stored";
  return "none";
}

/** Replace every occurrence of `secret` with `***` so it never reaches output. */
export function redact(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join("***");
}
