import { tokenSource } from "../canva/config.js";
import { createCanvaApi, TIMEOUTS } from "../canva/client.js";
import type { CommandOutput } from "./shared.js";

/**
 * Content-first home view (AXI principle 8). Shows live account state when
 * connected and a definitive onboarding object when not. Never throws: a
 * session must not start with an error because Canva is unreachable.
 */
export async function homeCommand(): Promise<CommandOutput> {
  if (tokenSource() === "none") {
    return {
      status: "not connected",
      help: [
        "Run `canva-axi auth login` to connect your Canva account (one-time browser approval)",
        "Run `canva-axi --help` to see all commands",
      ],
    };
  }
  try {
    const api = createCanvaApi();
    const search = await api.call(
      "search-designs",
      { query: "", sort_by: "modified_descending", limit: 5 },
      TIMEOUTS.fast,
    );
    const results = Array.isArray(search.results) ? search.results : [];
    const rows = results.map((item) => {
      const design = (item ?? {}) as Record<string, unknown>;
      return {
        id: String(design.id ?? ""),
        title: String(design.title ?? design.text ?? ""),
      };
    });
    const out: Record<string, unknown> = {
      connection: "ok",
      recent_designs: rows.length === 0
        ? "none — your library returned no designs yet"
        : rows,
      ...(rows.length ? { count: rows.length } : {}),
    };
    out.help = [
      "search your designs: canva-axi design search <query>",
      'create one from a brief: canva-axi design create "<brief>" --confirm',
      "list folders: canva-axi folder ls root",
    ];
    return out;
  } catch {
    return {
      status: "connected, but the Canva MCP server is unreachable right now",
      help: [
        "Run `canva-axi auth status --probe` to verify the session",
        "Run `canva-axi design search <query>` to retry",
      ],
    };
  }
}
