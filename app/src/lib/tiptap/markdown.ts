/**
 * Markdown utility functions for Carbon.
 *
 * The actual parse (MD → TipTap) and serialize (TipTap → MD) is handled by
 * `@tiptap/markdown`. This module provides helper utilities that do not depend
 * on a live editor instance.
 */

import type { AnyExtension, JSONContent } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { resolveRelativePath } from "../link-utils";
import { isPathInside } from "../path-utils";
import { CarbonCodeBlock } from "./carbon-code-block-extension";
import { CarbonImage } from "./carbon-image-extension";
import { CarbonLink } from "./carbon-link-extension";
import { CarbonPdf } from "./carbon-pdf-extension";
import { CarbonTable } from "./carbon-table-extension";
import { CarbonVideo } from "./carbon-video-extension";
// ── Clipboard formatting ────────────────────────────────────────

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
  const normalized = md.replace(/&nbsp;/g, " ").replace(/\r\n?/g, "\n");
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

export function serializeMarkdownContent(content: JSONContent | JSONContent[]): string {
  return CARBON_MARKDOWN_MANAGER.serialize({
    type: "doc",
    content: Array.isArray(content) ? content : [content],
  }).trim();
}

type TransformMarkdownForPdfExportInput = {
  markdown: string;
  currentNotePath: string;
  vaultPath: string;
};

const CARBON_MARKDOWN_MANAGER = createCarbonMarkdownManager();

export function transformMarkdownForPdfExport(input: TransformMarkdownForPdfExportInput): string {
  const normalized = input.markdown.replace(/\r\n?/g, "\n");
  const parsed = CARBON_MARKDOWN_MANAGER.parse(normalized);
  const transformed = transformPdfExportNode(parsed, input);

  if (!transformed) {
    return "";
  }

  return CARBON_MARKDOWN_MANAGER.serialize(transformed).trim();
}

function createCarbonMarkdownManager(): MarkdownManager {
  return new MarkdownManager({
    markedOptions: {
      gfm: true,
      breaks: false,
    },
    extensions: buildCarbonMarkdownExtensions(),
  });
}

function buildCarbonMarkdownExtensions(): AnyExtension[] {
  return [
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
  ];
}

function transformPdfExportNode(
  node: JSONContent,
  options: TransformMarkdownForPdfExportInput,
): JSONContent | null {
  const transformedContent = Array.isArray(node.content)
    ? node.content
      .map((child) => transformPdfExportNode(child, options))
      .filter((child): child is JSONContent => child !== null)
    : node.content;

  switch (node.type) {
    case "image":
      return transformPdfExportImageNode(node, options);
    case "paragraph":
    case "blockquote":
    case "bulletList":
    case "orderedList":
    case "listItem":
    case "taskList":
    case "taskItem":
      if (Array.isArray(transformedContent) && transformedContent.length === 0) {
        return null;
      }
      return { ...node, content: transformedContent };
    case "doc":
      return {
        ...node,
        content: Array.isArray(transformedContent) ? transformedContent : [],
      };
    default:
      return transformedContent === undefined
        ? node
        : { ...node, content: transformedContent };
  }
}

function transformPdfExportImageNode(
  node: JSONContent,
  options: TransformMarkdownForPdfExportInput,
): JSONContent | null {
  const attrs = node.attrs ?? {};
  const assetUri =
    typeof attrs["data-asset-uri"] === "string"
      ? (attrs["data-asset-uri"] as string)
      : "";
  const localSrc =
    typeof attrs["data-local-src"] === "string"
      ? (attrs["data-local-src"] as string)
      : "";
  const src = typeof attrs.src === "string" ? attrs.src : "";
  const href = assetUri || localSrc || src;
  if (!href) return null;

  const localFileUrl = resolvePdfExportLocalImageUrl(href, options);
  if (localFileUrl) {
    return {
      ...node,
      attrs: {
        ...attrs,
        src: localFileUrl,
        "data-local-src": null,
        "data-asset-uri": null,
        "data-asset-loading": false,
        "data-asset-error": false,
      },
    };
  }

  if (isPdfExportRemoteImageHref(href)) {
    return {
      ...node,
      attrs: {
        ...attrs,
        src: href,
        "data-local-src": null,
        "data-asset-uri": null,
        "data-asset-loading": false,
        "data-asset-error": false,
      },
    };
  }

  const alt = typeof attrs.alt === "string" ? attrs.alt : "";
  const title = typeof attrs.title === "string" ? attrs.title : "";
  const literal = buildEscapedMarkdownImageLiteral(alt, href, title || null);

  return {
    type: "paragraph",
    content: literal
      ? [
        {
          type: "text",
          text: literal,
        },
      ]
      : [],
  };
}

function buildEscapedMarkdownImageLiteral(
  alt: string,
  href: string,
  title: string | null,
): string {
  const imageMarkdown = title
    ? `![${alt}](${href} "${title}")`
    : `![${alt}](${href})`;

  return escapeMarkdownLiteral(imageMarkdown);
}

function escapeMarkdownLiteral(value: string): string {
  return value.replace(/([\\`*_[\]{}()#+\-.!>~|])/g, "\\$1");
}

function resolvePdfExportLocalImageUrl(
  href: string,
  options: TransformMarkdownForPdfExportInput,
): string | null {
  if (!isPdfExportLocalImageHref(href)) return null;

  const absolutePath = isAbsolutePath(href)
    ? href
    : resolveRelativePath(options.currentNotePath, href);

  if (!isPathInside(absolutePath, options.vaultPath)) {
    return null;
  }

  return toFileUrl(absolutePath);
}

function isPdfExportLocalImageHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("carbon://asset/")) return false;
  if (href.startsWith("blob:")) return false;
  if (href.startsWith("data:")) return false;
  if (href.startsWith("file://")) return true;
  if (/^https?:\/\//i.test(href)) return false;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(href) && !/^[A-Za-z]:[\\/]/.test(href)) {
    return false;
  }
  return true;
}

function isPdfExportRemoteImageHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function toFileUrl(absolutePath: string): string {
  if (absolutePath.startsWith("file://")) {
    return absolutePath;
  }

  if (/^[A-Za-z]:[\\/]/.test(absolutePath)) {
    const normalized = absolutePath.replace(/\\/g, "/");
    return `file:///${encodePathForFileUrl(normalized)}`;
  }

  if (absolutePath.startsWith("/")) {
    return `file://${encodePathForFileUrl(absolutePath)}`;
  }

  return `file://${encodePathForFileUrl(absolutePath.replace(/\\/g, "/"))}`;
}

function encodePathForFileUrl(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
    .replace(/%3A/g, ":");
}
