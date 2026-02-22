import { marked } from "marked";
import TurndownService from "turndown";

// Configure marked for GFM (task lists, tables, etc.)
marked.setOptions({
  gfm: true,
  breaks: false,
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

// Add task list support to turndown
turndown.addRule("taskListItem", {
  filter: (node) => {
    return (
      node.nodeName === "LI" &&
      node.parentNode !== null &&
      (node.parentNode as HTMLElement).getAttribute("data-type") === "taskList"
    );
  },
  replacement: (content, node) => {
    const checkbox = (node as HTMLElement).querySelector(
      'input[type="checkbox"]',
    );
    const checked = checkbox?.hasAttribute("checked") ? "x" : " ";
    const trimmedContent = content.replace(/^\n+/, "").replace(/\n+$/, "");
    return `- [${checked}] ${trimmedContent}\n`;
  },
});

/**
 * Convert Markdown string to HTML for TipTap.
 */
export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

/**
 * Convert TipTap HTML output to Markdown string.
 */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
