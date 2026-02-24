import { TaskItem, TaskList } from "@tiptap/extension-list";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { CarbonImage } from "../tiptap/carbon-image-extension";
import { CarbonLink } from "../tiptap/carbon-link-extension";
import { fixtures } from "./markdown-fixtures";

const markdownManager = new MarkdownManager({
  markedOptions: {
    gfm: true,
    breaks: false,
  },
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: { languageClassPrefix: "language-" },
      link: false,
    }),
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
