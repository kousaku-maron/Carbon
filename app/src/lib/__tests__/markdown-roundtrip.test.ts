import { TaskItem, TaskList } from "@tiptap/extension-list";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { CarbonCodeBlock } from "../tiptap/carbon-code-block-extension";
import { CarbonImage } from "../tiptap/carbon-image-extension";
import { CarbonLink } from "../tiptap/carbon-link-extension";
import { CarbonPdf } from "../tiptap/carbon-pdf-extension";
import { CarbonVideo } from "../tiptap/carbon-video-extension";
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
