import { describe, expect, it } from "vitest";
import {
  CARBON_FILE_CARD_CLASS,
  CARBON_FILE_CARD_KIND_CLASS,
  CARBON_FILE_CARD_TITLE_CLASS,
  CARBON_INTERNAL_LINK_CLASS,
  CARBON_LINK_CLASS,
  CARBON_MISSING_ASSET_CLASS,
  CARBON_MISSING_IMAGE_ASSET_CLASS,
  CARBON_MISSING_LINK_CLASS,
} from "@carbon/rendering";
import { buildRenderedHtml } from "./share-render";

describe("buildRenderedHtml", () => {
  it("renders unpublished markdown note links as tooltip text", () => {
    const html = buildRenderedHtml({
      title: "Spec",
      markdownBody: "[Other note](docs/other.md)",
      assets: [],
      links: [],
    });

    expect(html).toContain(
      `class="${CARBON_LINK_CLASS} ${CARBON_INTERNAL_LINK_CLASS} ${CARBON_MISSING_LINK_CLASS}"`,
    );
    expect(html).toContain('title="This page is not published"');
    expect(html).toContain('data-tooltip="This page is not published"');
    expect(html).toContain(">Other note</span>");
  });

  it("renders unresolved carbon asset images as missing placeholders", () => {
    const html = buildRenderedHtml({
      title: "Spec",
      markdownBody: "![Photo](carbon://asset/as_123)",
      assets: [],
      links: [],
    });

    expect(html).toContain(
      `class="${CARBON_MISSING_ASSET_CLASS} ${CARBON_MISSING_IMAGE_ASSET_CLASS}"`,
    );
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

    expect(html).toContain('src="https://example.com/assets/as_123"');
    expect(html).not.toContain("<p><figure");
    expect(html).not.toContain(`<div class="${CARBON_MISSING_ASSET_CLASS}`);
  });

  it("renders markdown task lists using TipTap-compatible markup", () => {
    const html = buildRenderedHtml({
      title: "Spec",
      markdownBody: "- [x] Done\n- [ ] Todo",
      assets: [],
      links: [],
    });

    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-checked="true">');
    expect(html).toContain('<li data-checked="false">');
    expect(html).toContain('type="checkbox" checked disabled');
    expect(html).toContain('type="checkbox" disabled');
    expect(html).toContain("<div><p>Done</p></div>");
    expect(html).toContain("<div><p>Todo</p></div>");
  });

  it("renders pdf directives as download cards", () => {
    const html = buildRenderedHtml({
      title: "Spec",
      markdownBody: 'Before\n\n:::pdf {src="../docs/demo.pdf" title="demo.pdf"} :::\n\nAfter',
      assets: [
        {
          kind: "pdf",
          sourceRef: "../docs/demo.pdf",
          title: "demo.pdf",
          publicUrl: "https://example.com/assets/demo.pdf",
          previewImageUrl: "https://example.com/assets/demo-preview.png",
        },
      ],
      links: [],
    });

    expect(html).toContain(`class="${CARBON_FILE_CARD_CLASS}"`);
    expect(html).toContain(`<div class="${CARBON_FILE_CARD_KIND_CLASS}">PDF</div>`);
    expect(html).toContain(`<div class="${CARBON_FILE_CARD_TITLE_CLASS}">demo.pdf</div>`);
    expect(html).toContain('href="https://example.com/assets/demo.pdf" target="_blank" rel="noreferrer"');
    expect(html).toContain(">Open</a>");
    expect(html).toContain('src="https://example.com/assets/demo-preview.png"');
    expect(html).not.toContain("__SHARE_BLOCK_");
    expect(html).toContain("<p>Before</p>");
    expect(html).toContain("<p>After</p>");
  });

  it("renders video directives without figcaption and keeps the video block structure", () => {
    const html = buildRenderedHtml({
      title: "Spec",
      markdownBody: 'Before\n\n:::video {src="../videos/demo.mp4" title="demo.mp4"} :::\n\nAfter',
      assets: [
        {
          kind: "video",
          sourceRef: "../videos/demo.mp4",
          title: "demo.mp4",
          publicUrl: "https://example.com/assets/demo.mp4",
        },
      ],
      links: [],
    });

    expect(html).toContain('<video class="carbon-video-embed" controls preload="metadata" src="https://example.com/assets/demo.mp4"></video>');
    expect(html).not.toContain("<figcaption>demo.mp4</figcaption>");
    expect(html).not.toContain("<p><figure");
    expect(html).toContain("<p>Before</p>");
    expect(html).toContain("<p>After</p>");
  });

  it("renders rich metadata for title, description, and favicon", () => {
    const html = buildRenderedHtml({
      title: "abc.md",
      markdownBody: "# abc.md\n\nこれは共有ページの説明文です。リンクや装飾を含んでも自然な description にしたいです。",
      assets: [],
      links: [],
      publicUrl: "https://example.com/s/st_123/abc",
      ogImageUrl: "https://example.com/assets/og-image.png",
    });

    expect(html).toContain("<title>Carbon | abc.md</title>");
    expect(html).toContain('rel="icon" type="image/png" href="data:image/png;base64,');
    expect(html).toContain('meta name="description" content="abc.md これは共有ページの説明文です。リンクや装飾を含んでも自然な description にしたいです。"');
    expect(html).toContain('meta property="og:title" content="Carbon | abc.md"');
    expect(html).toContain('meta property="og:site_name" content="Carbon"');
    expect(html).toContain('meta property="og:url" content="https://example.com/s/st_123/abc"');
    expect(html).toContain('meta property="og:image" content="https://example.com/assets/og-image.png"');
    expect(html).toContain('meta property="og:image:secure_url" content="https://example.com/assets/og-image.png"');
    expect(html).toContain('meta property="og:image:type" content="image/png"');
    expect(html).toContain('meta property="og:image:width" content="1200"');
    expect(html).toContain('meta property="og:image:height" content="630"');
    expect(html).toContain('meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('meta name="twitter:image" content="https://example.com/assets/og-image.png"');
  });
});
