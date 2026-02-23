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

// HTML→MD: When <img> has data-asset-uri, use that as the src in Markdown
turndown.addRule("assetImage", {
  filter: (node) => {
    return (
      node.nodeName === "IMG" &&
      !!(node as HTMLElement).getAttribute("data-asset-uri")
    );
  },
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const assetUri = el.getAttribute("data-asset-uri") || "";
    const alt = el.getAttribute("alt") || "";
    return `![${alt}](${assetUri})`;
  },
});

/**
 * Convert Markdown string to HTML for TipTap.
 * `carbon://asset/...` URLs are kept as-is in img src (resolved later by the editor).
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

function isFenceDelimiter(line: string): boolean {
  return /^(\s*)(`{3,}|~{3,})/.test(line);
}

function isListLine(line: string): boolean {
  return /^(\s*)([-+*]|\d+\.)\s+/.test(line);
}

/**
 * Normalize markdown spacing for clipboard copy without changing persisted data.
 */
export function formatMarkdownForCopy(md: string): string {
  const normalized = md.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const cleaned: string[] = [];
  let inFence = false;

  for (const rawLine of lines) {
    const trimmedLine = rawLine.replace(/[ \t]+$/g, "");

    if (isFenceDelimiter(trimmedLine)) {
      inFence = !inFence;
      cleaned.push(trimmedLine);
      continue;
    }

    if (inFence) {
      cleaned.push(trimmedLine);
      continue;
    }

    if (/^\s*$/.test(trimmedLine)) {
      cleaned.push("");
      continue;
    }

    const normalizedListSpacing = trimmedLine
      .replace(/^(\s*)([-+*])\s{2,}(?=\S)/, "$1$2 ")
      .replace(/^(\s*)(\d+\.)\s{2,}(?=\S)/, "$1$2 ");

    cleaned.push(normalizedListSpacing);
  }

  const compacted: string[] = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const line = cleaned[i];
    if (line !== "") {
      compacted.push(line);
      continue;
    }

    const prev = compacted.length > 0 ? compacted[compacted.length - 1] : "";
    let next = "";
    for (let j = i + 1; j < cleaned.length; j += 1) {
      if (cleaned[j] !== "") {
        next = cleaned[j];
        break;
      }
    }

    // Remove loose-list spacing produced by HTML->MD conversion.
    if (isListLine(prev) && isListLine(next)) {
      continue;
    }

    if (compacted.length > 0 && compacted[compacted.length - 1] === "") {
      continue;
    }

    compacted.push("");
  }

  const result = compacted.join("\n").replace(/^\n+|\n+$/g, "");
  return result;
}

const ASSET_URI_RE = /carbon:\/\/asset\/([a-zA-Z0-9_]+)/g;

/**
 * Extract all asset IDs from markdown text.
 */
export function extractAssetIds(md: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = ASSET_URI_RE.exec(md)) !== null) {
    ids.push(match[1]);
  }
  ASSET_URI_RE.lastIndex = 0;
  return ids;
}

/**
 * Extract asset IDs from an HTML string (TipTap output).
 */
export function extractAssetIdsFromHtml(html: string): string[] {
  const re = /data-asset-uri="carbon:\/\/asset\/([a-zA-Z0-9_]+)"/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

/**
 * Parse an asset URI to extract the asset ID.
 */
export function parseAssetUri(uri: string): string | null {
  const match = uri.match(/^carbon:\/\/asset\/([a-zA-Z0-9_]+)$/);
  return match ? match[1] : null;
}
