import { describe, expect, it } from "vitest";
import { buildPdfRenderDocument } from "./pdf-render-document";

describe("buildPdfRenderDocument", () => {
  it("converts vault-local images to file URLs for PDF rendering", () => {
    const document = buildPdfRenderDocument({
      noteId: "notes/daily/today.md",
      notePath: "/vault/notes/daily/today.md",
      noteName: "today",
      vaultPath: "/vault",
      markdownBody: "![agent](../Projects/Panasonic/assets/agent_with_current.png)",
    });

    expect(document.markdownBody).toBe(
      "![agent](file:///vault/notes/Projects/Panasonic/assets/agent_with_current.png)",
    );
    expect(document.assets).toEqual([]);
  });

  it("keeps note links internal while mapping external links to public URLs", () => {
    const document = buildPdfRenderDocument({
      noteId: "notes/daily/today.md",
      notePath: "/vault/notes/daily/today.md",
      noteName: "today",
      vaultPath: "/vault",
      markdownBody: [
        "[Other note](../other.md)",
        "[External](https://example.com)",
      ].join("\n\n"),
    });

    expect(document.links).toEqual([
      expect.objectContaining({
        href: "../other.md",
        kind: "note-link",
        targetNotePath: "notes/other.md",
      }),
      expect.objectContaining({
        href: "https://example.com",
        kind: "external-link",
        publicUrl: "https://example.com",
      }),
    ]);
  });

  it("preserves embedded video and pdf directives as static-label assets", () => {
    const document = buildPdfRenderDocument({
      noteId: "notes/daily/today.md",
      notePath: "/vault/notes/daily/today.md",
      noteName: "today",
      vaultPath: "/vault",
      markdownBody: [
        ':::video {src="../assets/demo.mp4" title="demo.mp4"} :::',
        ':::pdf {src="../docs/demo.pdf" title="demo.pdf"} :::',
      ].join("\n\n"),
    });

    expect(document.markdownBody).toContain(
      ':::video {src="../assets/demo.mp4" title="demo.mp4"} :::',
    );
    expect(document.markdownBody).toContain(
      ':::pdf {src="../docs/demo.pdf" title="demo.pdf"} :::',
    );
    expect(document.assets).toEqual([
      expect.objectContaining({
        kind: "video",
        sourceRef: "../assets/demo.mp4",
        title: "demo.mp4",
        publicUrl: null,
      }),
      expect.objectContaining({
        kind: "pdf",
        sourceRef: "../docs/demo.pdf",
        title: "demo.pdf",
        publicUrl: null,
      }),
    ]);
  });
});
