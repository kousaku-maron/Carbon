/**
 * Markdown round-trip regression fixtures.
 *
 * Each fixture contains:
 *   - input:    source Markdown
 *   - expected: Markdown after a full round-trip (parse → edit model → serialize)
 *
 * "expected" is best-effort — it represents the *acceptable* output,
 * not necessarily byte-identical reproduction.
 */

type MarkdownFixture = {
  name: string;
  input: string;
  /** Acceptable output after round-trip. `null` means "same as input". */
  expected: string | null;
};

export const fixtures: MarkdownFixture[] = [
  // ── Basic paragraphs & blank lines ────────────────────────────
  {
    name: "single paragraph",
    input: "Hello world",
    expected: "Hello world",
  },
  {
    name: "two paragraphs separated by blank line",
    input: "First paragraph\n\nSecond paragraph",
    expected: "First paragraph\n\nSecond paragraph",
  },
  {
    name: "multiple consecutive blank lines (best-effort)",
    input: "Paragraph A\n\n\n\nParagraph B",
    // Rich text models typically collapse to a single blank line
    expected: "Paragraph A\n\nParagraph B",
  },

  // ── Headings ──────────────────────────────────────────────────
  {
    name: "headings h1-h3",
    input: "# Heading 1\n\n## Heading 2\n\n### Heading 3",
    expected: "# Heading 1\n\n## Heading 2\n\n### Heading 3",
  },

  // ── Inline formatting ─────────────────────────────────────────
  {
    name: "bold and italic",
    input: "This is **bold** and *italic* text",
    expected: "This is **bold** and *italic* text",
  },
  {
    name: "inline code",
    input: "Use `console.log()` for debugging",
    expected: "Use `console.log()` for debugging",
  },

  // ── Lists ─────────────────────────────────────────────────────
  {
    name: "unordered list",
    input: "- Item A\n- Item B\n- Item C",
    expected: "- Item A\n- Item B\n- Item C",
  },
  {
    name: "ordered list",
    input: "1. First\n2. Second\n3. Third",
    expected: "1. First\n2. Second\n3. Third",
  },

  // ── Task lists ────────────────────────────────────────────────
  {
    name: "task list (unchecked and checked)",
    input: "- [ ] Todo item\n- [x] Done item",
    expected: "- [ ] Todo item\n- [x] Done item",
  },
  {
    name: "nested task list",
    input: "- [ ] Parent\n  - [x] Child done\n  - [ ] Child todo",
    expected: "- [ ] Parent\n  - [x] Child done\n  - [ ] Child todo",
  },

  // ── Links ─────────────────────────────────────────────────────
  {
    name: "relative internal link",
    input: "See [my note](../notes/other.md) for details",
    expected: "See [my note](../notes/other.md) for details",
  },
  {
    name: "external link",
    input: "Visit [Google](https://google.com)",
    expected: "Visit [Google](https://google.com)",
  },
  // ── Images ────────────────────────────────────────────────────
  {
    name: "carbon asset image",
    input: "![photo](carbon://asset/abc123)",
    expected: "![photo](carbon://asset/abc123)",
  },
  {
    name: "regular image",
    input: "![alt text](https://example.com/image.png)",
    expected: "![alt text](https://example.com/image.png)",
  },
  {
    name: "image with title",
    input: '![alt text](https://example.com/image.png "My title")',
    expected: '![alt text](https://example.com/image.png "My title")',
  },
  {
    name: "local relative video",
    input: ':::video {src="../assets/demo.mp4" title="demo.mp4"} :::',
    expected: ':::video {src="../assets/demo.mp4" title="demo.mp4"} :::',
  },
  {
    name: "local relative pdf",
    input: ':::pdf {src="../docs/demo.pdf" title="demo.pdf"} :::',
    expected: ':::pdf {src="../docs/demo.pdf" title="demo.pdf"} :::',
  },

  // ── Code blocks ───────────────────────────────────────────────
  {
    name: "fenced code block",
    input: "```js\nconst x = 1;\n```",
    expected: "```js\nconst x = 1;\n```",
  },

  // ── Blockquotes ───────────────────────────────────────────────
  {
    name: "blockquote",
    input: "> This is a quote\n>\n> Second line",
    expected: "> This is a quote\n>\n> Second line",
  },

  // ── Mixed content ─────────────────────────────────────────────
  {
    name: "mixed content (heading, paragraph, list, code)",
    input: [
      "# Title",
      "",
      "Some text with **bold**.",
      "",
      "- Item 1",
      "- Item 2",
      "",
      "```ts",
      "const y = 2;",
      "```",
    ].join("\n"),
    expected: null, // same as input
  },
];
