import { describe, expect, it } from "vitest";
import { parseCommandArgs, flagDefaults, type CommandArgsSpec } from "../src/flags.js";
import { AxiError } from "axi-sdk-js";

const spec: CommandArgsSpec = {
  command: "test",
  flags: [
    { name: "limit", type: "string", default: "10" },
    { name: "full", type: "boolean" },
    { name: "ref", type: "repeat" },
    { name: "kind", type: "string", values: ["a", "b"] },
  ],
  args: [{ name: "id", required: true, description: "" }],
};

describe("parseCommandArgs", () => {
  it("parses defaults, positionals, strings, booleans, repeats", () => {
    const parsed = parseCommandArgs(["DAF123", "--full", "--ref", "M1", "--ref", "M2"], spec);
    expect(parsed.positionals).toEqual(["DAF123"]);
    expect(parsed.strings.limit).toBe("10");
    expect(parsed.booleans.full).toBe(true);
    expect(parsed.repeats.ref).toEqual(["M1", "M2"]);
  });

  it("supports --flag=value inline", () => {
    const parsed = parseCommandArgs(["X", "--limit=25"], spec);
    expect(parsed.strings.limit).toBe("25");
  });

  it("rejects unknown flags with the valid list", () => {
    expect(() => parseCommandArgs(["X", "--bogus"], spec)).toThrowError(AxiError);
    try {
      parseCommandArgs(["X", "--bogus"], spec);
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("VALIDATION_ERROR");
      expect(axi.suggestions.join(" ")).toContain("--limit");
    }
  });

  it("rejects invalid enum values", () => {
    try {
      parseCommandArgs(["X", "--kind", "z"], spec);
      expect.unreachable();
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("VALIDATION_ERROR");
      expect(axi.suggestions.join(" ")).toContain("valid values: a, b");
    }
  });

  it("rejects a string flag missing its value", () => {
    expect(() => parseCommandArgs(["X", "--limit"], spec)).toThrowError(/--limit requires a value/);
  });

  it("rejects boolean flags given a value", () => {
    expect(() => parseCommandArgs(["X", "--full=true"], spec)).toThrowError(/does not take a value/);
  });

  it("rejects missing required positionals with usage", () => {
    expect(() => parseCommandArgs([], spec)).toThrowError(/missing required argument <id>/);
  });

  it("rejects extra positionals", () => {
    expect(() => parseCommandArgs(["A", "B"], spec)).toThrowError(/unexpected argument 'B'/);
  });

  it("treats everything after -- as positionals", () => {
    const parsed = parseCommandArgs(["--", "--not-a-flag"], spec);
    expect(parsed.positionals).toEqual(["--not-a-flag"]);
  });

  it("defaults are materialized", () => {
    const parsed = flagDefaults(spec);
    expect(parsed.strings.limit).toBe("10");
    expect(parsed.repeats.ref).toEqual([]);
  });
});
