function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/&(nbsp|#160|#xa0);/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveDocumentTitle(markdown: string, fallbackTitle: string): string {
  const withoutCodeFences = markdown.replace(/```[\s\S]*?```/g, "\n");
  const lines = withoutCodeFences.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]?.trim() ?? "";
    if (!current) continue;

    const atxMatch = current.match(/^#\s+(.*)$/);
    if (atxMatch?.[1]) {
      const title = stripInlineMarkdown(atxMatch[1]);
      if (title) return title;
    }

    const next = lines[index + 1]?.trim() ?? "";
    if (next && /^=+$/.test(next)) {
      const title = stripInlineMarkdown(current);
      if (title) return title;
    }
  }

  return fallbackTitle;
}
