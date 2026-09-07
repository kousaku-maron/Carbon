import { parse, postprocess, preprocess } from "micromark";
import { decodeString } from "micromark-util-decode-string";
import { getRelativePath, resolveVaultLocalPath } from "../../link-utils";
import { isPathInside, toVaultRelative } from "../../path-utils";

export interface MarkdownLink {
  start: number;
  end: number;
  target: string;
  suffix: string;
  rootRelative: boolean;
}

/** Source offsets let us replace destinations without reformatting the document. */
export function collectMarkdownLinks(body: string, source: string, vault: string): MarkdownLink[] {
  // YAML frontmatter is metadata, not Markdown. Keep all source offsets intact.
  const input = body.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,
    (frontmatter) => frontmatter.replace(/[^\r\n]/g, " "));
  const events = postprocess(parse().document().write(preprocess()(input, undefined, true)));
  const links: MarkdownLink[] = [];
  for (const [kind, token] of events) {
    if (kind !== "enter" || !["resourceDestinationString", "definitionDestinationString"].includes(token.type)) continue;
    const start = token.start.offset;
    const end = token.end.offset;
    const href = decodeString(body.slice(start, end));
    if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(href)) continue;
    const suffixAt = href.search(/[?#]/);
    const path = suffixAt < 0 ? href : href.slice(0, suffixAt);
    const suffix = suffixAt < 0 ? "" : href.slice(suffixAt);
    const target = resolveVaultLocalPath(source, path, vault);
    if (!isPathInside(target, vault)) continue;
    links.push({ start, end, target, suffix, rootRelative: path.startsWith("/") });
  }
  return links;
}

export function relocatedPath(path: string, from: string, to: string): string {
  return isPathInside(path, from) ? to + path.slice(from.length) : path;
}

export function rewriteMarkdownLinks(body: string, source: string, vault: string, from: string, to: string): string {
  const nextSource = relocatedPath(source, from, to);
  let result = body;
  for (const link of collectMarkdownLinks(body, source, vault).reverse()) {
    const nextTarget = relocatedPath(link.target, from, to);
    const pathFor = (note: string, target: string) => link.rootRelative
      ? `/${toVaultRelative(target, vault)}` : getRelativePath(note, target);
    const before = pathFor(source, link.target);
    const after = pathFor(nextSource, nextTarget);
    if (before === after) continue;
    const destination = after.split("/").map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`),
    ).join("/") + link.suffix;
    result = result.slice(0, link.start) + destination + result.slice(link.end);
  }
  return result;
}
