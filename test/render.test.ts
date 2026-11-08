import { describe, expect, it } from "vitest";
import { encode } from "@toon-format/toon";
import {
  searchDesignsView,
  designDetailView,
  designContentView,
  pagesView,
  commentsView,
  folderItemsView,
  exportFormatsView,
  assetsView,
  datasetView,
  truncate,
  transactionView,
  pendingJobView,
} from "../src/render.js";

/** Render tests assert the TOON contract: counts, rows, truncation, empty states. */

describe("views", () => {
  it("searchDesignsView emits count + rows + definitive empty state", () => {
    const full = searchDesignsView({
      results: [
        { id: "DAF1", title: "Launch Deck", url: "https://canva.com/d/1" },
        { id: "DAF2", title: "Poster" },
      ],
    });
    expect(full.count).toBe(2);
    expect(encode(full)).toContain("results[2]{id,title,url}:");

    const empty = searchDesignsView({ results: [] });
    expect(encode(empty)).toContain("0 designs matched");
  });

  it("truncate appends a size hint with --full escape", () => {
    const out = truncate("word ".repeat(100), 40);
    expect(out).toContain("… (");
    expect(out).toContain("use --full");
  });

  it("designDetailView includes edit_url and expiry-marked thumbnail", () => {
    const view = designDetailView({
      id: "DAF1",
      title: "T",
      urls: { edit_url: "https://e", view_url: "https://v" },
      thumbnail: { url: "https://thumb" },
      updated_at: 1784078453,
    });
    const text = encode(view);
    expect(text).toContain("edit_url");
    expect(text).toContain("thumbnail_expires_15m");
    expect(text).toContain("updated");
  });

  it("designContentView truncates text and points at edit start", () => {
    const view = designContentView({
      id: "DAF1",
      title: "T",
      text: "line\n".repeat(500),
      metadata: { page_count: 3 },
    });
    const text = encode(view);
    expect(text).toContain("use --full");
    expect(text).toContain("edit start");
  });

  it("pagesView lists pages with dimensions", () => {
    const view = pagesView({
      items: [
        { id: "P1", page_number: 1, dimensions: { width: 1920, height: 1080 } },
        { id: "P2", page_number: 2, dimensions: { width: 1920, height: 1080 } },
      ],
    });
    expect(encode(view)).toContain("1920x1080");
    expect(view.count).toBe(2);
  });

  it("commentsView shows a definitive empty state", () => {
    expect(encode(commentsView({ items: [] }))).toContain("no comment threads");
  });

  it("folderItemsView pre-computes a contents summary", () => {
    const view = folderItemsView({
      items: [
        { type: "design", design: { id: "D1", title: "A" } },
        { type: "folder", folder: { id: "F1", name: "B" } },
        { type: "design", design: { id: "D2", title: "C" } },
      ],
    });
    expect(view.contents).toBe("2 designs, 1 folder");
  });

  it("exportFormatsView lists formats with page coverage", () => {
    const view = exportFormatsView({
      formats: {
        pdf: { page_numbers: [1, 2] },
        mp4: { page_numbers: [2] },
      },
    });
    const text = encode(view);
    expect(text).toContain("pdf");
    expect(text).toContain("1+2");
  });

  it("assetsView separates found assets from per-id lookup errors", () => {
    const view = assetsView({
      blocks: [
        { asset: { id: "A1", type: "image", name: "Hero", tags: ["team"] } },
        { error: { code: "asset_not_found", message: "nope" } },
      ],
    });
    expect(view.found).toBe(1);
    expect(view.failed).toBe(1);
  });

  it("datasetView lists field types and a definitive empty state", () => {
    const full = datasetView(
      { dataset: { event_title: { type: "text" }, hero_image: { type: "image" } } },
      "template",
      "BTM1",
    );
    expect(encode(full)).toContain("fields[2]{field,type}");
    const empty = datasetView({ dataset: {} }, "template", "BTM1");
    expect(encode(empty)).toContain("no autofill fields");
  });

  it("transactionView exposes element ids for perform", () => {
    const view = transactionView(
      {
        transaction: { transaction_id: "TXN1", status: "open" },
        richtexts: [
          {
            element_id: "E1",
            page_index: 1,
            regions: [{ type: "character", text: "Hello world headline" }],
          },
        ],
        fills: [{ element_id: "E2", page_index: 1, type: "image", asset_id: "A1" }],
        pages: [{ page_number: 1, dimension: { width: 1080, height: 1350 }, is_responsive: false }],
      },
      "DAF1",
    );
    const text = encode(view);
    expect(text).toContain("richtexts[1]{element_id,page,text}");
    expect(text).toContain("Hello world headline");
    expect(text).toContain("fills[1]{element_id,page,type,asset_id}");
  });

  it("pendingJobView carries the polling contract", () => {
    const view = pendingJobView({
      job_id: "job1",
      status: "in_progress",
      continuation_token: "tok",
      polling_policy: { wait_seconds: 15, instructions: "Wait at least 15 seconds" },
    });
    expect(view.wait_seconds).toBe(15);
    expect((view.help as string[])[0]).toContain("design job");
  });
});
