import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvaApi, type RawToolCaller } from "../src/canva/client.js";
import { AxiError } from "axi-sdk-js";

/**
 * Client tests drive createCanvaApi with an injected fake tool caller so no
 * network or credentials are needed. The fake returns real MCP envelope
 * shapes: { content: [{ type: "text", text: JSON }] }.
 */

let dir: string;
const previousXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canva-axi-client-"));
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

function apiWith(
  responder: (name: string, args: Record<string, unknown>) => unknown,
): {
  api: ReturnType<typeof createCanvaApi>;
  calls: Array<{ name: string; args: Record<string, unknown>; timeoutMs: number }>;
} {
  const calls: Array<{ name: string; args: Record<string, unknown>; timeoutMs: number }> = [];
  const callTool: RawToolCaller = async (name, args, timeoutMs) => {
    calls.push({ name, args, timeoutMs });
    return envelope(responder(name, args));
  };
  return { api: createCanvaApi({ callTool }), calls };
}

describe("createCanvaApi", () => {
  it("calls a tool and unwraps the text envelope", async () => {
    const { api, calls } = apiWith(() => ({ results: [{ id: "DAF1", title: "Deck" }] }));
    const payload = await api.call("search-designs", { query: "deck" });
    expect(payload.results).toHaveLength(1);
    expect(calls[0]?.name).toBe("search-designs");
    expect(calls[0]?.args.query).toBe("deck");
  });

  it("prefers structuredContent when present", async () => {
    const { api } = apiWith(() => null);
    const custom: RawToolCaller = async () => ({
      structuredContent: { hello: "world" },
      content: [{ type: "text", text: "{\"hello\":\"stale\"}" }],
    });
    const client = createCanvaApi({ callTool: custom });
    expect(await client.call("get-design", {})).toEqual({ hello: "world" });
    void api;
  });

  it("merges multi-block responses into blocks[] (get-assets shape)", async () => {
    const custom: RawToolCaller = async () => ({
      content: [
        { type: "text", text: JSON.stringify({ asset: { id: "A1", type: "image", name: "Hero" } }) },
        { type: "image", data: "…" },
        { type: "text", text: JSON.stringify({ error: { code: "asset_not_found", message: "no" } }) },
      ],
    });
    const client = createCanvaApi({ callTool: custom });
    const payload = await client.call("get-assets", { asset_ids: ["A1", "A2"] });
    expect(Array.isArray(payload.blocks)).toBe(true);
    expect((payload.blocks as unknown[]).length).toBe(2);
  });

  it("maps job.status=failed payloads to structured errors", async () => {
    const { api } = apiWith(() => ({
      job: { id: "job1", status: "failed", error: { code: "fetch_failed", message: "not 200" } },
    }));
    await expect(api.call("upload-asset-from-url", {})).rejects.toMatchObject({
      code: "UPSTREAM",
    });
  });

  it("maps rate limit tool errors", async () => {
    const { api } = apiWith(() => ({
      isError: true,
      error: { code: "rate_limited", message: "too many requests" },
    }));
    await expect(api.call("generate-design", {})).rejects.toMatchObject({
      code: "RATE_LIMIT",
    });
  });

  it("maps missing-scope errors to AUTH with reconnect help", async () => {
    const { api } = apiWith(() => ({
      isError: true,
      error: { code: "forbidden", message: "Missing scopes: [brandkit:read]" },
    }));
    try {
      await api.call("list-brand-kits", {});
      expect.unreachable();
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("AUTH");
      expect(axi.suggestions.join(" ")).toContain("auth login");
    }
  });

  it("maps license_required export errors to PAYMENT_REQUIRED", async () => {
    const { api } = apiWith(() => ({
      job: { id: "j", status: "failed", error: { code: "license_required", message: "premium element" } },
    }));
    await expect(api.call("export-design", {})).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    });
  });

  it("maps not_found errors with a search suggestion", async () => {
    const { api } = apiWith(() => ({
      isError: true,
      error: { code: "not_found", message: "design not found" },
    }));
    try {
      await api.call("get-design", {});
      expect.unreachable();
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("NOT_FOUND");
      expect(axi.suggestions.join(" ")).toContain("design search");
    }
  });

  it("uses the job timeout for server-wrapped job tools via explicit arg", async () => {
    const { api, calls } = apiWith(() => ({ job: { id: "j", status: "success" } }));
    await api.call("export-design", {}, 180_000);
    expect(calls[0]?.timeoutMs).toBe(180_000);
  });
});
