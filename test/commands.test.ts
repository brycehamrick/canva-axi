import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { designCommand } from "../src/commands/design.js";
import { editCommand } from "../src/commands/edit.js";
import { commentCommand } from "../src/commands/comment.js";
import { generateCommand } from "../src/commands/generate.js";
import { folderCommand } from "../src/commands/folder.js";
import { exportCommand } from "../src/commands/export.js";
import { toolsCommand } from "../src/commands/tools.js";
import type { CanvaApi, RawToolCaller } from "../src/canva/client.js";

/**
 * Command tests run handlers directly with an injected fake API. They assert
 * the confirm-gate contract (no network before --confirm), argument mapping
 * to MCP tool calls, and view shaping.
 */

let dir: string;
const previousXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canva-axi-cmd-"));
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.CANVA_ACCESS_TOKEN;
});

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  rmSync(dir, { recursive: true, force: true });
});

function envelope(payload: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fakeApi(
  responder: (name: string, args: Record<string, unknown>) => unknown,
): { api: CanvaApi; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const callTool: RawToolCaller = async (name, args) => {
    calls.push({ name, args });
    return envelope(responder(name, args));
  };
  return { api: { call: async (n, a) => responder(n, a) as Record<string, unknown>, close: async () => {}, server: () => "fake" }, calls };
}

/** Wrapper matching the deps shape commands take; records every call. */
function depsWith(responder: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const callTool: RawToolCaller = async (name, args) => {
    calls.push({ name, args });
    return envelope(responder(name, args));
  };
  const api = {
    call: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const raw = responder(name, args);
      if (raw && typeof raw === "object" && (raw as { isError?: boolean }).isError) {
        const err = (raw as { error?: { code?: string; message?: string } }).error ?? {};
        throw new AxiError(`Canva API error: ${err.message ?? ""}`, "UPSTREAM");
      }
      return raw as Record<string, unknown>;
    },
    close: async () => {},
    server: () => "fake",
  };
  return { createApi: () => api as CanvaApi, calls };
}

describe("design command", () => {
  it("search calls search-designs with limit and continuation", async () => {
    const deps = depsWith(() => ({ results: [{ id: "DAF1", title: "Deck" }] }));
    await designCommand(["search", "deck", "--limit", "20"], deps as never);
    expect(deps.calls[0]?.name).toBe("search-designs");
    expect(deps.calls[0]?.args).toMatchObject({ query: "deck", limit: 20 });
  });

  it("get accepts a share URL and normalizes the design id", async () => {
    const deps = depsWith(() => ({ design: { id: "DAF123abcde", title: "T" } }));
    await designCommand(
      ["get", "https://www.canva.com/design/DAF123abcde/tok/edit"],
      deps as never,
    );
    expect(deps.calls[0]?.args.design_id).toBe("DAF123abcde");
  });

  it("create refuses without --confirm before any network", async () => {
    const deps = depsWith(() => ({}));
    await expect(
      designCommand(["create", "5-slide deck"], deps as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deps.calls.length).toBe(0);
  });

  it("create with --confirm starts the job and polls to completion", async () => {
    const deps = depsWith((name) => {
      if (name === "create-design") {
        return {
          job_id: "job1",
          status: "pending",
          continuation_token: "tok1",
          polling_policy: { wait_seconds: 0 },
        };
      }
      return {
        job_id: "job1",
        status: "completed",
        design: { id: "DAFDONE", url: "https://canva.com/d/DONE" },
      };
    });
    const out = (await designCommand(["create", "poster", "--confirm"], deps as never)) as Record<
      string,
      unknown
    >;
    expect(deps.calls[0]?.name).toBe("create-design");
    expect(deps.calls[1]?.name).toBe("get-create-design-async-job");
    expect(out.job_id).toBe("job1");
    expect(String(JSON.stringify(out))).toContain("DAFDONE");
  });

  it("job surfaces polled_too_early with a wait hint", async () => {
    const deps = depsWith(() => ({
      job_id: "job1",
      status: "polled_too_early",
      continuation_token: "tok",
    }));
    const out = (await designCommand(
      ["job", "job1", "--token", "tok"],
      deps as never,
    )) as Record<string, unknown>;
    expect(out.status).toBe("polled_too_early");
    expect((out.help as string[])[0]).toContain("wait");
  });

  it("notes reads presenter notes and truncates", async () => {
    const deps = depsWith(() => ({
      items: [
        { page_number: 1, notes: "Welcome the audience. x".repeat(60) },
        { page_number: 2, notes: "Short note" },
      ],
    }));
    const out = (await designCommand(["notes", "DAF1"], deps as never)) as Record<string, unknown>;
    expect(deps.calls[0]?.name).toBe("get-presenter-notes");
    expect(out.count).toBe(2);
    expect(JSON.stringify(out)).toContain("use --full");
  });

  it("edit thumbnail returns the signed url with expiry warning", async () => {
    const deps = depsWith(() => ({ thumbnail: { url: "https://thumb/signed" } }));
    const { editCommand } = await import("../src/commands/edit.js");
    const out = (await editCommand(["thumbnail", "TXN1", "2"], deps as never)) as Record<string, unknown>;
    expect(deps.calls[0]?.args).toMatchObject({ transaction_id: "TXN1", page_index: 2 });
    expect(out.thumbnail_expires_15m).toBe("https://thumb/signed");
  });

  it("design thumbnail redirects to the edit flow", async () => {
    const deps = depsWith(() => ({}));
    await expect(designCommand(["thumbnail", "DAF1"], deps as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("copy requires --confirm", async () => {
    const deps = depsWith(() => ({}));
    await expect(designCommand(["copy", "DAF1"], deps as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(deps.calls.length).toBe(0);
  });

  it("copy with pages parses comma list", async () => {
    const deps = depsWith(() => ({ design: { id: "DAF2", title: "Copy" } }));
    await designCommand(["copy", "DAF1", "--pages", "1,3,5", "--confirm"], deps as never);
    expect(deps.calls[0]?.args).toMatchObject({ design_id: "DAF1", page_numbers: [1, 3, 5] });
  });

  it("merge requires --from-design for insert_pages", async () => {
    const deps = depsWith(() => ({}));
    await expect(
      designCommand(
        ["merge", "DAF1", "--op", "insert_pages", "--pages", "1", "--confirm"],
        deps as never,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("merge builds a single insert operation", async () => {
    const deps = depsWith(() => ({
      job: { id: "j", status: "success", result: { design: { id: "DAF2", title: "Merged" } } },
    }));
    await designCommand(
      ["merge", "DAF1", "--op", "insert_pages", "--from-design", "DAG9", "--pages", "5,6", "--confirm"],
      deps as never,
    );
    expect(deps.calls[0]?.args).toEqual({
      type: "modify_existing_design",
      design_id: "DAF1",
      operations: [{ type: "insert_pages", source_design_id: "DAG9", page_numbers: [5, 6] }],
    });
  });
});

describe("edit command", () => {
  it("start returns transaction with element ids", async () => {
    const deps = depsWith(() => ({
      transaction: { transaction_id: "TXN1", status: "open" },
      richtexts: [{ element_id: "E1", page_index: 1, regions: [{ text: "Headline" }] }],
    }));
    const out = (await editCommand(["start", "DAF1"], deps as never)) as Record<string, unknown>;
    expect(out.transaction_id).toBe("TXN1");
    expect(deps.calls[0]?.name).toBe("start-editing-transaction");
    expect(JSON.stringify(out)).toContain("E1");
  });

  it("perform builds replace_text operation", async () => {
    const deps = depsWith(() => ({ edit_operation_results: [{ status: "success", operation_info: { type: "replace_text", element_id: "E1" } }] }));
    await editCommand(
      ["perform", "TXN1", "--page", "1", "--op", "replace_text", "--element", "E1", "--text", "New"],
      deps as never,
    );
    expect(deps.calls[0]?.args).toMatchObject({
      transaction_id: "TXN1",
      page_index: 1,
      operations: [{ type: "replace_text", element_id: "E1", text: "New" }],
    });
  });

  it("perform builds find_and_replace_text with the server's find_text/replace_text keys", async () => {
    const deps = depsWith(() => ({ edit_operation_results: [] }));
    await editCommand(
      ["perform", "TXN1", "--op", "find_and_replace_text", "--element", "E1", "--find", "old", "--text", "new"],
      deps as never,
    );
    expect(deps.calls[0]?.args.operations).toEqual([
      { type: "find_and_replace_text", element_id: "E1", find_text: "old", replace_text: "new" },
    ]);
  });

  it("perform builds update_fill with asset_type and alt_text", async () => {
    const deps = depsWith(() => ({ edit_operation_results: [] }));
    await editCommand(
      ["perform", "TXN1", "--op", "update_fill", "--element", "E2", "--asset", "A1", "--alt", "Team photo"],
      deps as never,
    );
    expect(deps.calls[0]?.args.operations).toEqual([
      {
        type: "update_fill",
        element_id: "E2",
        asset_type: "image",
        asset_id: "A1",
        alt_text: "Team photo",
      },
    ]);
  });

  it("perform requires --alt for fills (server-required)", async () => {
    const deps = depsWith(() => ({}));
    await expect(
      editCommand(
        ["perform", "TXN1", "--op", "update_fill", "--element", "E2", "--asset", "A1"],
        deps as never,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deps.calls.length).toBe(0);
  });

  it("perform rejects ops outside the live schema enum", async () => {
    const deps = depsWith(() => ({}));
    try {
      await editCommand(["perform", "TXN1", "--op", "bogus_op"], deps as never);
      expect.unreachable();
    } catch (error) {
      expect((error as AxiError).suggestions.join(" ")).toContain("replace_text");
    }
  });

  it("commit requires --confirm", async () => {
    const deps = depsWith(() => ({}));
    await expect(editCommand(["commit", "TXN1"], deps as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("comment command", () => {
  it("add enforces the 1000-char limit before network", async () => {
    const deps = depsWith(() => ({}));
    await expect(
      commentCommand(["add", "DAF1", "--message", "x".repeat(1001), "--confirm"], deps as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deps.calls.length).toBe(0);
  });

  it("add requires --confirm", async () => {
    const deps = depsWith(() => ({}));
    await expect(
      commentCommand(["add", "DAF1", "--message", "hi"], deps as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("add sends message_plaintext", async () => {
    const deps = depsWith(() => ({
      thread: { id: "C1", thread_type: { content: { plaintext: "hi" } } },
    }));
    await commentCommand(["add", "DAF1", "--message", "hi", "--confirm"], deps as never);
    expect(deps.calls[0]?.args).toMatchObject({
      design_id: "DAF1",
      message_plaintext: "hi",
    });
  });
});

describe("generate command", () => {
  it("refuses without --confirm before network", async () => {
    const deps = depsWith(() => ({}));
    await expect(generateCommand(["make me a poster"], deps as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(deps.calls.length).toBe(0);
  });

  it("image passes refs as MEDIA references", async () => {
    const deps = depsWith(() => ({ jobId: "job9" }));
    await generateCommand(
      ["image", "golden hour", "--ref", "M1", "--ref", "M2", "--confirm"],
      deps as never,
    );
    expect(deps.calls[0]?.args).toEqual({
      prompt: "golden hour",
      imageReferences: [{ type: "MEDIA", id: "M1" }, { type: "MEDIA", id: "M2" }],
    });
  });
});

describe("folder command", () => {
  it("ls root passes folder_id root", async () => {
    const deps = depsWith(() => ({ items: [] }));
    await folderCommand(["ls", "root"], deps as never);
    expect(deps.calls[0]?.args).toMatchObject({ folder_id: "root" });
  });

  it("create requires --name and --confirm", async () => {
    const deps = depsWith(() => ({}));
    await expect(folderCommand(["create", "--name", "Q4"], deps as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(folderCommand(["create", "--confirm"], deps as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("export command", () => {
  it("formats lists available formats", async () => {
    const deps = depsWith(() => ({ formats: { pdf: { page_numbers: [1] } } }));
    await exportCommand(["formats", "DAF1"], deps as never);
    expect(deps.calls[0]?.name).toBe("get-export-formats");
  });

  it("export requires --format", async () => {
    const deps = depsWith(() => ({}));
    await expect(exportCommand(["DAF1"], deps as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("export maps pages into a format object and is ungated (render-only)", async () => {
    const deps = depsWith(() => ({ job: { id: "j", status: "success", urls: ["https://x"] } }));
    await exportCommand(["DAF1", "--format", "png", "--pages", "1,3"], deps as never);
    expect(deps.calls[0]?.args).toMatchObject({
      design_id: "DAF1",
      format: { type: "png", pages: [1, 3] },
    });
  });
});

describe("unknown subcommands fail loud", () => {
  it("edit rejects bogus subcommands with the valid list", async () => {
    const deps = depsWith(() => ({}));
    try {
      await editCommand(["bogus"], deps as never);
      expect.unreachable();
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.suggestions.join(" ")).toContain("start | perform | commit | cancel");
    }
  });

  it("design rejects bogus subcommands with the full valid list", async () => {
    const deps = depsWith(() => ({}));
    try {
      await designCommand(["bogus"], deps as never);
      expect.unreachable();
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.suggestions.join(" ")).toContain("search | get | content");
      expect(axi.suggestions.join(" ")).toContain("notes | thumbnail");
    }
  });
});

describe("tools command", () => {
  const fakeApi = (tools: Array<{ name: string; description: string; inputSchema: unknown }>): CanvaApi =>
    ({
      call: async () => {
        throw new Error("should not call tools via callTool");
      },
      listTools: async () => tools,
      close: async () => {},
      server: () => "fake",
    }) as CanvaApi;

  it("lists the catalog via listTools, never callTool", async () => {
    const out = (await toolsCommand(
      [],
      fakeApi([
        { name: "search-designs", description: "Find a user's existing designs by keyword.", inputSchema: {} },
        { name: "get-design", description: "Look up the metadata.", inputSchema: {} },
      ]),
    )) as Record<string, unknown>;
    expect(out.count).toBe(2);
    expect(JSON.stringify(out)).toContain("search-designs");
  });

  it("--schema returns the live input schema", async () => {
    const out = (await toolsCommand(
      ["--schema", "generate-design"],
      fakeApi([
        {
          name: "generate-design",
          description: "Create design candidates.",
          inputSchema: { type: "object", properties: { brief: { type: "string" } } },
        },
      ]),
    )) as Record<string, unknown>;
    expect(out.tool).toBe("generate-design");
    expect(JSON.stringify(out.input_schema)).toContain("brief");
  });

  it("--schema fails loud for unknown tools", async () => {
    await expect(toolsCommand(["--schema", "nope"], fakeApi([]))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

void fakeApi;
