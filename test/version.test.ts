import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { readFileSync } from "node:fs";

describe("version", () => {
  it("src/version.ts matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
