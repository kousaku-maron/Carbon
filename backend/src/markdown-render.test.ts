import { describe, expect, it } from "vitest";
import {
  CARBON_EMBED_CLASS,
  CARBON_INTERNAL_LINK_CLASS,
  CARBON_LINK_CLASS,
  buildRenderedMarkdownHtml,
} from "@carbon/rendering";

describe("buildRenderedMarkdownHtml", () => {
  it("renders PDF-safe markdown", () => {
    const html = buildRenderedMarkdownHtml({
      markdownBody: [
        "# Document",
        "",
        "[External](https://example.com)",
        "",
        "[Other note](notes/other.md)",
        "",
        "![Photo](carbon://asset/as_123)",
      ].join("\n"),
      assets: [],
      links: [
        { href: "https://example.com", kind: "external-link", publicUrl: "https://example.com" },
        { href: "notes/other.md", kind: "note-link", targetNotePath: "notes/other.md" },
      ],
    });

    expect(html).toContain("<h1>Document</h1>");
    expect(html).toContain('<a class="carbon-link" data-href="https://example.com" href="https://example.com"');
    expect(html).toContain(`class="${CARBON_LINK_CLASS} ${CARBON_INTERNAL_LINK_CLASS}"`);
    expect(html).not.toContain("carbon://asset/as_123");
  });

  it("renders vault-local images using the generic embed class", () => {
    const html = buildRenderedMarkdownHtml({
      markdownBody: "![Photo](file:///vault/photo.png)",
      assets: [
        {
          kind: "image",
          sourceRef: "file:///vault/photo.png",
          publicUrl: "file:///vault/photo.png",
        },
      ],
      links: [],
    });

    expect(html).toContain(`class="${CARBON_EMBED_CLASS}"`);
    expect(html).toContain('src="file:///vault/photo.png"');
  });
});
