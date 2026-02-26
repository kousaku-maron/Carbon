/**
 * Markdown utility functions for Carbon.
 *
 * The actual parse (MD → TipTap) and serialize (TipTap → MD) is now handled
 * by `@tiptap/markdown` through the editor instance. This module provides
 * helper utilities that do NOT depend on an editor instance.
 */

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
