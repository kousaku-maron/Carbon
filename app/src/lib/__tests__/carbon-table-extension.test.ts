import { describe, expect, it } from "vitest";
import { looksLikeMarkdownTablePaste } from "../tiptap/carbon-table-extension";

describe("looksLikeMarkdownTablePaste", () => {
  it("detects gfm tables", () => {
    expect(looksLikeMarkdownTablePaste("| A | B |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
  });

  it("detects alignment delimiter rows", () => {
    expect(looksLikeMarkdownTablePaste("| A | B |\n| :--- | ---: |\n| 1 | 2 |")).toBe(true);
  });

  it("does not flag plain prose", () => {
    expect(looksLikeMarkdownTablePaste("This is just a normal sentence.")).toBe(false);
  });

  it("does not flag pipe-delimited plain text without a delimiter row", () => {
    expect(looksLikeMarkdownTablePaste("A | B | C")).toBe(false);
  });

  it("does not flag markdown headings", () => {
    expect(looksLikeMarkdownTablePaste("# Heading")).toBe(false);
  });
});
