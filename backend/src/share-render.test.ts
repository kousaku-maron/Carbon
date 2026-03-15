import { describe, expect, it } from "vitest";
import { buildRenderedHtml } from "./share-render";

describe("buildRenderedHtml", () => {
  it("renders unpublished markdown note links as tooltip text", () => {
    const html = buildRenderedHtml({
      title: "Spec",
      markdownBody: "[Other note](docs/other.md)",
      assets: [],
      links: [],
    });

    expect(html).toContain('class="share-link share-link--missing"');
    expect(html).toContain('title="このページは公開されていません"');
    expect(html).toContain(">Other note</span>");
  });

  it("renders unresolved carbon asset images as missing placeholders", () => {
    const html = buildRenderedHtml({
      title: "Spec",
      markdownBody: "![Photo](carbon://asset/as_123)",
      assets: [],
      links: [],
    });

    expect(html).toContain('class="share-missing-asset share-missing-asset--image"');
    expect(html).toContain("Photo");
    expect(html).not.toContain('img src="carbon://asset/as_123"');
  });

  it("renders available share assets using their public URLs", () => {
    const html = buildRenderedHtml({
      title: "Spec",
      markdownBody: "![Photo](carbon://asset/as_123)",
      assets: [
        {
          kind: "image",
          sourceRef: "carbon://asset/as_123",
          publicUrl: "https://example.com/assets/as_123",
        },
      ],
      links: [],
    });

    expect(html).toContain('img src="https://example.com/assets/as_123"');
    expect(html).not.toContain('<div class="share-missing-asset');
  });
});
