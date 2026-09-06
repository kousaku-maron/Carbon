import { marked } from "marked";
import {
  CARBON_FILE_CARD_ACTION_CLASS,
  CARBON_FILE_CARD_CLASS,
  CARBON_FILE_CARD_KIND_CLASS,
  CARBON_FILE_CARD_META_CLASS,
  CARBON_FILE_CARD_PREVIEW_CLASS,
  CARBON_FILE_CARD_PREVIEW_IMAGE_CLASS,
  CARBON_FILE_CARD_TITLE_CLASS,
  CARBON_IMAGE_EMBED_CLASS,
  CARBON_IMAGE_FRAME_CLASS,
  CARBON_IMAGE_NODE_CLASS,
  CARBON_INTERNAL_LINK_CLASS,
  CARBON_LINK_CLASS,
  CARBON_MISSING_ASSET_CLASS,
  CARBON_MISSING_IMAGE_ASSET_CLASS,
  CARBON_PDF_FRAME_CLASS,
  CARBON_PDF_NODE_CLASS,
  CARBON_EMBED_CLASS,
  CARBON_VIDEO_FRAME_CLASS,
  CARBON_VIDEO_NODE_CLASS,
} from "./class-names";

export type RenderedLinkItem = {
  href: string;
  kind: "note-link" | "file-link" | "external-link";
  targetNotePath?: string | null;
  publicUrl?: string | null;
};

export type RenderedAssetItem = {
  kind: string;
  sourceRef: string;
  title?: string | null;
  publicUrl?: string | null;
  previewImageUrl?: string | null;
};

type BuildRenderedMarkdownHtmlInput = {
  markdownBody: string;
  assets: RenderedAssetItem[];
  links: RenderedLinkItem[];
};

function replaceEvery(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function joinClasses(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

function renderFigure(title: string | null | undefined, inner: string): string {
  if (!title) return `<figure class="${CARBON_EMBED_CLASS}">${inner}</figure>`;
  return `<figure class="${CARBON_EMBED_CLASS}">${inner}<figcaption>${escapeHtml(title)}</figcaption></figure>`;
}

function parseDirectiveAttributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /([A-Za-z0-9_-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

function isLikelyLocalMarkdownLink(href: string): boolean {
  return /(^|\/|\\)[^/\\]+\.md(#.*)?$/i.test(href) && !/^[A-Za-z][A-Za-z\d+.-]*:/.test(href);
}

function renderStaticLink(text: string): string {
  return `<span class="${CARBON_LINK_CLASS}">${text}</span>`;
}

function renderStaticInternalLink(text: string): string {
  return `<span class="${joinClasses(CARBON_LINK_CLASS, CARBON_INTERNAL_LINK_CLASS)}">${text}</span>`;
}

function renderMissingAsset(kind: string, label: string): string {
  const safeLabel = escapeHtml(label);

  if (kind === "image") {
    return `<div class="${joinClasses(CARBON_MISSING_ASSET_CLASS, CARBON_MISSING_IMAGE_ASSET_CLASS)}" role="img" aria-label="${safeLabel}">${safeLabel}</div>`;
  }

  return `<div class="${CARBON_MISSING_ASSET_CLASS}">${safeLabel}</div>`;
}

function isMermaidLanguage(language: string | undefined): boolean {
  return language?.trim().toLowerCase() === "mermaid";
}

function renderMermaidBlock(source: string): string {
  const escapedSource = escapeHtml(source);
  return `<pre><code class="language-mermaid">${escapedSource}</code></pre>`;
}

function renderCardAction(actionLabel: string): string {
  return `<span class="${CARBON_FILE_CARD_ACTION_CLASS}">${escapeHtml(actionLabel)}</span>`;
}

function renderDownloadCard(input: {
  kindLabel: string;
  title: string;
  actionLabel: string;
  previewImageUrl?: string | null;
}) {
  const preview = input.previewImageUrl
    ? `<div class="${CARBON_FILE_CARD_PREVIEW_CLASS}"><img class="${CARBON_FILE_CARD_PREVIEW_IMAGE_CLASS}" src="${escapeAttr(input.previewImageUrl)}" alt="" loading="lazy" /></div>`
    : "";
  return `<div class="${CARBON_FILE_CARD_CLASS}">${preview}<div class="${CARBON_FILE_CARD_META_CLASS}"><div class="${CARBON_FILE_CARD_KIND_CLASS}">${escapeHtml(input.kindLabel)}</div><div class="${CARBON_FILE_CARD_TITLE_CLASS}">${escapeHtml(input.title)}</div></div>${renderCardAction(input.actionLabel)}</div>`;
}

function isStandaloneBlockHtml(html: string): boolean {
  return /^(<figure\b|<div class="(?:carbon-image-node|carbon-video-node|carbon-pdf-node|carbon-missing-asset))/i.test(
    html.trim(),
  );
}

function isBlockHtml(html: string): boolean {
  return /^(<(p|ul|ol|blockquote|pre|figure|div|table|h[1-6]|hr)\b)/i.test(html.trim());
}

function renderTaskListItemContent(
  tokens: Array<{ type?: string }> | undefined,
  renderer: any,
): string {
  const bodyTokens = normalizeMarkedTokens(tokens ?? []).filter((token) => token.type !== "checkbox");
  const html = bodyTokens.map((token: any) => {
    if (token.type === "text") {
      const inline = token.tokens
        ? marked.Parser.parseInline(token.tokens, { renderer })
        : escapeHtml(token.text ?? token.raw ?? "");
      return inline ? `<p>${inline}</p>` : "";
    }

    if (token.type === "list") {
      return renderer.list(token);
    }

    if (token.type === "space") {
      return "";
    }

    return String(marked.Parser.parse([token] as never, { renderer }));
  }).join("");
  if (!html) return "<p></p>";
  return isBlockHtml(html) ? html : `<p>${html}</p>`;
}

function normalizeMarkedTokens<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMarkedTokens(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const token = value as Record<string, unknown>;
  const normalizedType =
    token.type === "taskList"
      ? "list"
      : token.type === "taskItem"
        ? "list_item"
        : token.type;

  const normalized: Record<string, unknown> = {
    ...token,
    type: normalizedType,
  };

  if ("items" in normalized) {
    normalized.items = normalizeMarkedTokens(normalized.items);
  }

  if ("tokens" in normalized) {
    normalized.tokens = normalizeMarkedTokens(normalized.tokens);
  }

  return normalized as T;
}

export function buildRenderedMarkdownHtml(input: BuildRenderedMarkdownHtmlInput): string {
  const assetUrlBySource = new Map(input.assets.map((asset) => [asset.sourceRef, asset]));
  const linkByHref = new Map(input.links.map((link) => [link.href, link]));
  const directiveHtml = new Map<string, string>();
  let directiveIndex = 0;

  const markdownWithDirectives = input.markdownBody.replace(
    /:::([a-z]+)\s*\{([^}]*)\}\s*:::/g,
    (_raw, kind: string, attrsRaw: string) => {
      const attrs = parseDirectiveAttributes(attrsRaw);
      const src = attrs.src ?? "";
      const title = attrs.title ?? null;
      const asset = assetUrlBySource.get(src);
      const placeholder = `<!--__CARBON_RENDER_BLOCK_${directiveIndex++}__-->`;

      if (!asset) {
        directiveHtml.set(
          placeholder,
          renderFigure(title, renderMissingAsset(kind, `Asset unavailable: ${src}`)),
        );
        return placeholder;
      }

      if (kind === "video") {
        directiveHtml.set(
          placeholder,
          renderFigure(
            null,
            `<div class="${CARBON_VIDEO_NODE_CLASS}"><div class="${CARBON_VIDEO_FRAME_CLASS}">${renderStaticLink(title ?? asset.title ?? "Video")}</div></div>`,
          ),
        );
        return placeholder;
      }

      if (kind === "pdf") {
        directiveHtml.set(
          placeholder,
          renderFigure(
            null,
            `<div class="${CARBON_PDF_NODE_CLASS}"><div class="${CARBON_PDF_FRAME_CLASS}">${renderStaticLink(title ?? asset.title ?? "PDF")}</div></div>`,
          ),
        );
        return placeholder;
      }

      directiveHtml.set(
        placeholder,
        renderFigure(
          null,
          renderDownloadCard({
            kindLabel: "File",
            title: title ?? asset.title ?? "File",
            actionLabel: "Attachment",
          }),
        ),
      );
      return placeholder;
    },
  );

  const renderer = new marked.Renderer();

  renderer.html = ({ text }) => {
    const resolved = directiveHtml.get(text);
    return resolved ?? escapeHtml(text);
  };

  renderer.paragraph = ({ tokens }) => {
    const inner = tokens ? marked.Parser.parseInline(tokens, { renderer }) : "";
    if (isStandaloneBlockHtml(inner)) {
      return inner;
    }
    return `<p>${inner}</p>`;
  };

  renderer.list = ({ ordered, start, items }) => {
    const hasTaskItems = items.some((item) => item.task);
    const tag = ordered ? "ol" : "ul";
    const attrs = [
      hasTaskItems ? ' data-type="taskList"' : "",
      ordered && typeof start === "number" && start > 1 ? ` start="${start}"` : "",
    ].join("");
    const inner = items.map((item) => renderer.listitem(item)).join("");
    return `<${tag}${attrs}>${inner}</${tag}>`;
  };

  renderer.listitem = (item) => {
    if (!item.task) {
      const inner = item.tokens ? marked.Parser.parse(item.tokens as never, { renderer }) : item.text;
      return `<li>${inner}</li>`;
    }

    const checked = item.checked === true;
    const contentHtml = renderTaskListItemContent(item.tokens, renderer);
    return `<li data-checked="${checked ? "true" : "false"}"><label><input type="checkbox"${checked ? " checked" : ""} disabled /><span></span></label><div>${contentHtml}</div></li>`;
  };

  renderer.code = ({ text, lang }) => {
    if (isMermaidLanguage(lang)) {
      return renderMermaidBlock(text);
    }

    const languageClass = lang ? ` class="language-${escapeAttr(lang)}"` : "";
    return `<pre><code${languageClass}>${escapeHtml(text)}</code></pre>`;
  };

  renderer.link = ({ href, title, tokens }) => {
    const label = tokens ? marked.Parser.parseInline(tokens) : escapeHtml(href);
    const mappedLink = linkByHref.get(href);
    if (mappedLink?.publicUrl) {
      const className =
        mappedLink.kind === "note-link"
          ? joinClasses(CARBON_LINK_CLASS, CARBON_INTERNAL_LINK_CLASS)
          : CARBON_LINK_CLASS;
      const attrs = mappedLink.kind === "external-link"
        ? ` data-href="${escapeAttr(mappedLink.publicUrl)}" href="${escapeAttr(mappedLink.publicUrl)}"`
        : "";
      const target = mappedLink.kind === "external-link" ? ' target="_blank" rel="noreferrer"' : "";
      if (mappedLink.kind !== "external-link") {
        return mappedLink.kind === "note-link"
          ? renderStaticInternalLink(label)
          : renderStaticLink(label);
      }
      return `<a class="${className}"${attrs}${title ? ` title="${escapeAttr(title)}"` : ""}${target}>${label}</a>`;
    }

    if (mappedLink?.kind === "note-link" || isLikelyLocalMarkdownLink(href)) {
      return renderStaticInternalLink(label);
    }

    if (mappedLink?.kind === "file-link") {
      return renderStaticLink(label);
    }

    if (!/^https?:\/\//i.test(href) && !href.startsWith("mailto:")) {
      return renderStaticLink(label);
    }

    return `<a class="${CARBON_LINK_CLASS}" data-href="${escapeAttr(href)}" href="${escapeAttr(href)}"${title ? ` title="${escapeAttr(title)}"` : ""} target="_blank" rel="noreferrer">${label}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    if (href.startsWith("carbon://asset/") || href.startsWith("blob:")) {
      return "";
    }
    const asset = assetUrlBySource.get(href);
    const src = asset ? (asset.publicUrl ?? "") : href;
    if (!src) {
      return renderFigure(title, renderMissingAsset("image", text || "Image unavailable"));
    }
    const alt = escapeAttr(text);
    const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : "";
    return `<figure class="${CARBON_EMBED_CLASS}"><div class="${CARBON_IMAGE_NODE_CLASS}"><div class="${CARBON_IMAGE_FRAME_CLASS}"><img class="${CARBON_IMAGE_EMBED_CLASS}" src="${escapeAttr(src)}" alt="${alt}" loading="lazy" /></div></div>${caption}</figure>`;
  };

  const lexedTokens = marked.lexer(markdownWithDirectives, {
    breaks: true,
    gfm: true,
  });
  let bodyHtml = String(
    marked.Parser.parse(normalizeMarkedTokens(lexedTokens) as never, { renderer }),
  );

  for (const [placeholder, html] of directiveHtml) {
    bodyHtml = replaceEvery(bodyHtml, placeholder, html);
    bodyHtml = replaceEvery(bodyHtml, escapeHtml(placeholder), html);
  }

  return bodyHtml;
}
