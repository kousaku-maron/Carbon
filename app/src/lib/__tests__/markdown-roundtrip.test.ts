import { TaskItem, TaskList } from "@tiptap/extension-list";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { CarbonCodeBlock } from "../tiptap/carbon-code-block-extension";
import { CarbonImage } from "../tiptap/carbon-image-extension";
import { CarbonLink } from "../tiptap/carbon-link-extension";
import { CarbonPdf } from "../tiptap/carbon-pdf-extension";
import { CarbonTable } from "../tiptap/carbon-table-extension";
import { CarbonVideo } from "../tiptap/carbon-video-extension";
import { transformMarkdownForPdfExport } from "../tiptap/markdown";
import { fixtures } from "./markdown-fixtures";

const markdownManager = new MarkdownManager({
  markedOptions: {
    gfm: true,
    breaks: false,
  },
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: false,
    }),
    CarbonCodeBlock.configure({ languageClassPrefix: "language-" }),
    CarbonLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {
        target: null,
        rel: null,
      },
    }),
    CarbonTable,
    TaskList,
    TaskItem.configure({ nested: true }),
    CarbonImage.configure({ inline: false }),
    CarbonVideo.configure({ currentNotePath: null }),
    CarbonPdf.configure({ currentNotePath: null }),
  ],
});

function normalizeMarkdown(md: string): string {
  return md.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
}

describe("Markdown round-trip fixtures", () => {
  it.each(fixtures)("$name", ({ input, expected }) => {
    const parsed = markdownManager.parse(input);
    const output = markdownManager.serialize(parsed);
    expect(normalizeMarkdown(output)).toBe(normalizeMarkdown(expected ?? input));
  });
});

describe("Asset image serialization", () => {
  it("does not persist blob preview image URLs", () => {
    const output = markdownManager.serialize({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "blob:https://example.com/preview-image",
            alt: "preview",
            "data-asset-uri": null,
          },
        },
      ],
    });

    expect(normalizeMarkdown(output)).toBe("");
  });

  it("persists carbon asset URI instead of signed image URL", () => {
    const output = markdownManager.serialize({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "https://signed.example.com/image.png?exp=123",
            alt: "uploaded",
            "data-asset-uri": "carbon://asset/as_123",
          },
        },
      ],
    });

    expect(normalizeMarkdown(output)).toBe("![uploaded](carbon://asset/as_123)");
  });

  it("preserves image title when serializing markdown", () => {
    const output = markdownManager.serialize({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "https://example.com/image.png",
            alt: "with title",
            title: "My title",
            "data-asset-uri": null,
          },
        },
      ],
    });

    expect(normalizeMarkdown(output)).toBe(
      '![with title](https://example.com/image.png "My title")',
    );
  });

  it("persists vault-absolute local image paths", () => {
    const output = markdownManager.serialize({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "blob:https://example.com/preview-image",
            alt: "preview",
            "data-local-src": "/.carbon/assets/demo.png",
          },
        },
      ],
    });

    expect(normalizeMarkdown(output)).toBe(
      "![preview](/.carbon/assets/demo.png)",
    );
  });
});

describe("Local video serialization", () => {
  it("persists data-local-src instead of blob preview URLs", () => {
    const output = markdownManager.serialize({
      type: "doc",
      content: [
        {
          type: "video",
          attrs: {
            src: "blob:https://example.com/preview-video",
            title: "demo.mp4",
            "data-local-src": "../assets/demo.mp4",
          },
        },
      ],
    });

    expect(normalizeMarkdown(output)).toBe(
      ':::video {src="../assets/demo.mp4" title="demo.mp4"} :::',
    );
  });

  it("persists vault-absolute local video paths", () => {
    const output = markdownManager.serialize({
      type: "doc",
      content: [
        {
          type: "video",
          attrs: {
            src: "blob:https://example.com/preview-video",
            title: "demo.mp4",
            "data-local-src": "/.carbon/assets/demo.mp4",
          },
        },
      ],
    });

    expect(normalizeMarkdown(output)).toBe(
      ':::video {src="/.carbon/assets/demo.mp4" title="demo.mp4"} :::',
    );
  });
});

describe("Local PDF serialization", () => {
  it("persists local pdf node as markdown block", () => {
    const output = markdownManager.serialize({
      type: "doc",
      content: [
        {
          type: "pdf",
          attrs: {
            src: "../docs/demo.pdf",
            title: "demo.pdf",
          },
        },
      ],
    });

    expect(normalizeMarkdown(output)).toBe(
      ':::pdf {src="../docs/demo.pdf" title="demo.pdf"} :::',
    );
  });
});

describe("PDF export markdown transform", () => {
  it("converts local image markdown into a file URL", () => {
    const output = transformMarkdownForPdfExport({
      markdown: "![agent](../Projects/Panasonic/assets/agent_with_current.png)",
      currentNotePath: "/vault/notes/daily/today.md",
      vaultPath: "/vault",
    });

    expect(normalizeMarkdown(output)).toBe(
      "![agent](file:///vault/notes/Projects/Panasonic/assets/agent_with_current.png)",
    );
  });

  it("converts vault-absolute local image markdown into a file URL", () => {
    const output = transformMarkdownForPdfExport({
      markdown: "![agent](/.carbon/assets/agent_with_current.png)",
      currentNotePath: "/vault/notes/daily/today.md",
      vaultPath: "/vault",
    });

    expect(normalizeMarkdown(output)).toBe(
      "![agent](file:///vault/.carbon/assets/agent_with_current.png)",
    );
  });

  it("renders vault-external local image markdown as literal text", () => {
    const output = transformMarkdownForPdfExport({
      markdown: "![agent](../../../outside/agent_with_current.png)",
      currentNotePath: "/vault/notes/daily/today.md",
      vaultPath: "/vault",
    });

    expect(normalizeMarkdown(output)).toBe(
      "\\!\\[agent\\]\\(\\.\\./\\.\\./\\.\\./outside/agent\\_with\\_current\\.png\\)",
    );
  });

  it("preserves remote image markdown", () => {
    const output = transformMarkdownForPdfExport({
      markdown: "![cover](https://example.com/cover.png)",
      currentNotePath: "/vault/notes/daily/today.md",
      vaultPath: "/vault",
    });

    expect(normalizeMarkdown(output)).toBe(
      "![cover](https://example.com/cover.png)",
    );
  });

  it("renders carbon asset image markdown as literal text", () => {
    const output = transformMarkdownForPdfExport({
      markdown: "![uploaded](carbon://asset/as_123)",
      currentNotePath: "/vault/notes/daily/today.md",
      vaultPath: "/vault",
    });

    expect(normalizeMarkdown(output)).toBe(
      "\\!\\[uploaded\\]\\(carbon://asset/as\\_123\\)",
    );
  });

  it("preserves embedded video and pdf directives for static PDF rendering", () => {
    const output = transformMarkdownForPdfExport({
      markdown: [
        "# Demo",
        "",
        ':::video {src="../assets/demo.mp4" title="demo.mp4"} :::',
        "",
        ':::pdf {src="../docs/demo.pdf" title="demo.pdf"} :::',
        "",
        "After",
      ].join("\n"),
      currentNotePath: "/vault/notes/daily/today.md",
      vaultPath: "/vault",
    });

    const normalized = normalizeMarkdown(output);
    expect(normalized).toContain("# Demo");
    expect(normalized).toContain(':::video {src="../assets/demo.mp4" title="demo.mp4"} :::');
    expect(normalized).toContain(':::pdf {src="../docs/demo.pdf" title="demo.pdf"} :::');
    expect(normalized).toContain("After");
  });

  it("preserves markdown tables for static PDF rendering", () => {
    const output = transformMarkdownForPdfExport({
      markdown: [
        "# Demo",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
      ].join("\n"),
      currentNotePath: "/vault/notes/daily/today.md",
      vaultPath: "/vault",
    });

    const normalized = normalizeMarkdown(output);
    expect(normalized).toContain("| A   | B   |");
    expect(normalized).toContain("| --- | --- |");
    expect(normalized).toContain("| 1   | 2   |");
  });
});
