import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readConfig,
  writeConfig,
  updateConfig,
  deleteConfig,
  tokenSource,
  redact,
  ENV_TOKEN_VAR,
} from "../src/canva/config.js";

let dir: string;
const previousXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canva-axi-config-"));
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env[ENV_TOKEN_VAR];
});

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  rmSync(dir, { recursive: true, force: true });
});

describe("config store", () => {
  it("round-trips a token set", () => {
    writeConfig({ tokens: { access_token: "at", refresh_token: "rt", client_id: "cid" } });
    expect(readConfig().tokens?.access_token).toBe("at");
    expect(readConfig().tokens?.client_id).toBe("cid");
    expect(existsSync(join(dir, "canva-axi", "config.json"))).toBe(true);
  });

  it("updateConfig patches atomically", () => {
    writeConfig({});
    updateConfig((current) => ({ ...current, tokens: { access_token: "fresh" } }));
    expect(readConfig().tokens?.access_token).toBe("fresh");
  });

  it("deleteConfig reports whether a file existed", () => {
    expect(deleteConfig()).toBe(false);
    writeConfig({ tokens: { access_token: "x" } });
    expect(deleteConfig()).toBe(true);
    expect(readConfig().tokens).toBeUndefined();
  });

  it("token source prefers env over stored", () => {
    expect(tokenSource()).toBe("none");
    writeConfig({ tokens: { access_token: "stored" } });
    expect(tokenSource()).toBe("stored");
    process.env[ENV_TOKEN_VAR] = "env-token";
    expect(tokenSource()).toBe("env");
  });

  it("stored config parses even with a stale file", () => {
    // no file written: readConfig must return {} not throw
    expect(readConfig()).toEqual({});
  });

  it("redact strips secrets from text", () => {
    expect(redact("bearer abcdefghijk here", "abcdefghijk")).toBe("bearer *** here");
    expect(redact("short", "s")).toBe("short");
  });

  it("writes with 0600 permissions", () => {
    writeConfig({ tokens: { access_token: "t" } });
    const mode = statSync(join(dir, "canva-axi", "config.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
