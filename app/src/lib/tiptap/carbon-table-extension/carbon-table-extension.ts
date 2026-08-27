import {
  Extension,
  type JSONContent,
  type MarkdownParseHelpers,
  type MarkdownRendererHelpers,
  type MarkdownToken,
} from "@tiptap/core";
import { Table, TableKit } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const MARKDOWN_TABLE_DELIMITER_PATTERN = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
const TABLE_CELL_LINE_BREAK = "<br>";
const TABLE_CELL_LINE_BREAK_PATTERN = /^<br\s*\/?>$/i;

type MarkdownTableCellToken = {
  tokens?: MarkdownToken[];
};

type MarkdownTableToken = MarkdownToken & {
  header?: MarkdownTableCellToken[];
  rows?: MarkdownTableCellToken[][];
};

type RenderedTableCell = {
  text: string;
  isHeader: boolean;
};

function normalizeTablePasteText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function looksLikeMarkdownTablePaste(text: string): boolean {
  const lines = normalizeTablePasteText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return false;

  const [headerLine, delimiterLine] = lines;
  if (!headerLine.includes("|")) return false;

  return MARKDOWN_TABLE_DELIMITER_PATTERN.test(delimiterLine);
}

function normalizeTableCellTokens(tokens: MarkdownToken[]): MarkdownToken[] {
  return tokens.map((token) => {
    const raw = String(token.raw ?? token.text ?? "").trim();
    if (token.type === "html" && TABLE_CELL_LINE_BREAK_PATTERN.test(raw)) {
      return { ...token, type: "br" };
    }

    return Array.isArray(token.tokens)
      ? { ...token, tokens: normalizeTableCellTokens(token.tokens) }
      : token;
  });
}

function parseTableCell(
  cell: MarkdownTableCellToken,
  helpers: MarkdownParseHelpers,
): JSONContent {
  return helpers.createNode("paragraph", {}, [
    ...helpers.parseInline(normalizeTableCellTokens(cell.tokens ?? [])),
  ]);
}

function parseTableFromMarkdown(
  token: MarkdownTableToken,
  helpers: MarkdownParseHelpers,
): JSONContent {
  const rows: JSONContent[] = [];

  if (token.header) {
    rows.push(
      helpers.createNode(
        "tableRow",
        {},
        token.header.map((cell) =>
          helpers.createNode("tableHeader", {}, [parseTableCell(cell, helpers)]),
        ),
      ),
    );
  }

  for (const row of token.rows ?? []) {
    rows.push(
      helpers.createNode(
        "tableRow",
        {},
        row.map((cell) =>
          helpers.createNode("tableCell", {}, [parseTableCell(cell, helpers)]),
        ),
      ),
    );
  }

  return helpers.createNode("table", undefined, rows);
}

function replaceHardBreaks(node: JSONContent): JSONContent {
  if (node.type === "hardBreak") {
    return {
      type: "text",
      text: TABLE_CELL_LINE_BREAK,
      marks: node.marks,
    };
  }

  return Array.isArray(node.content)
    ? { ...node, content: node.content.map(replaceHardBreaks) }
    : node;
}

function renderTableCell(
  cell: JSONContent,
  helpers: MarkdownRendererHelpers,
): string {
  const blocks = cell.content ?? [];
  const rendered = blocks
    .map((block) => helpers.renderChildren(replaceHardBreaks(block)))
    .join(TABLE_CELL_LINE_BREAK);

  return rendered.replace(/\s+/g, " ").trim();
}

function renderTableToMarkdown(
  node: JSONContent,
  helpers: MarkdownRendererHelpers,
): string {
  const rows: RenderedTableCell[][] = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({
      text: renderTableCell(cell, helpers),
      isHeader: cell.type === "tableHeader",
    })),
  );
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount === 0) return "";

  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      3,
      ...rows.map((row) => row[columnIndex]?.text.length ?? 0),
    ),
  );
  const pad = (value: string, width: number) =>
    value + " ".repeat(Math.max(0, width - value.length));
  const headerRow = rows[0] ?? [];
  const hasHeader = headerRow.some((cell) => cell.isHeader);
  const header = Array.from({ length: columnCount }, (_, columnIndex) =>
    hasHeader ? headerRow[columnIndex]?.text ?? "" : "",
  );

  let markdown = `\n| ${header
    .map((text, columnIndex) => pad(text, columnWidths[columnIndex]))
    .join(" | ")} |\n`;
  markdown += `| ${columnWidths
    .map((width) => "-".repeat(width))
    .join(" | ")} |\n`;

  for (const row of hasHeader ? rows.slice(1) : rows) {
    const cells = Array.from({ length: columnCount }, (_, columnIndex) =>
      pad(row[columnIndex]?.text ?? "", columnWidths[columnIndex]),
    );
    markdown += `| ${cells.join(" | ")} |\n`;
  }

  return markdown;
}

const CarbonMarkdownTable = Table.extend({
  parseMarkdown: (token, helpers) =>
    parseTableFromMarkdown(token as MarkdownTableToken, helpers),
  renderMarkdown: (node, helpers) => renderTableToMarkdown(node, helpers),
});

export const CarbonTable = Extension.create({
  name: "carbonTable",

  addExtensions() {
    return [TableKit.configure({ table: false }), CarbonMarkdownTable];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("carbonTablePaste"),
        props: {
          handlePaste: (_view, event) => {
            const text = event.clipboardData?.getData("text/plain");
            if (!text || !this.editor.markdown) return false;
            if (this.editor.isActive("codeBlock")) return false;

            const html = event.clipboardData?.getData("text/html")?.trim();
            if (html) return false;
            if (!looksLikeMarkdownTablePaste(text)) return false;

            return this.editor.commands.insertContent(text, {
              contentType: "markdown",
            });
          },
        },
      }),
    ];
  },
});
