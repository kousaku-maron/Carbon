import { Extension } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const MARKDOWN_TABLE_DELIMITER_PATTERN = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;

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

export const CarbonTable = Extension.create({
  name: "carbonTable",

  addExtensions() {
    return [TableKit];
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
