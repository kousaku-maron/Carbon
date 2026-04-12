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
  CARBON_MISSING_LINK_CLASS,
  CARBON_PDF_FRAME_CLASS,
  CARBON_PDF_NODE_CLASS,
  CARBON_SHARE_DOWNLOAD_CLASS,
  CARBON_SHARE_EMBED_CLASS,
  CARBON_SHARE_OPEN_CLASS,
  CARBON_VIDEO_EMBED_CLASS,
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

type RenderMode = "share" | "pdf";

type BuildRenderedMarkdownHtmlInput = {
  markdownBody: string;
  assets: RenderedAssetItem[];
  links: RenderedLinkItem[];
  mode?: RenderMode;
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
  if (!title) return `<figure class="${CARBON_SHARE_EMBED_CLASS}">${inner}</figure>`;
  return `<figure class="${CARBON_SHARE_EMBED_CLASS}">${inner}<figcaption>${escapeHtml(title)}</figcaption></figure>`;
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

function renderMissingLink(text: string, mode: RenderMode): string {
  const message = mode === "pdf" ? "This page is not available in PDF" : "This page is not published";
  return `<span class="${joinClasses(CARBON_LINK_CLASS, CARBON_INTERNAL_LINK_CLASS, CARBON_MISSING_LINK_CLASS)}" data-href="" data-tooltip="${message}" aria-disabled="true" title="${message}">${text}</span>`;
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

function renderCardAction(input: {
  mode: RenderMode;
  href?: string | null;
  actionLabel: string;
  openInNewTab?: boolean;
}) {
  const className = joinClasses(
    CARBON_FILE_CARD_ACTION_CLASS,
    input.openInNewTab ? CARBON_SHARE_OPEN_CLASS : CARBON_SHARE_DOWNLOAD_CLASS,
  );

  if (input.mode === "pdf" || !input.href) {
    return `<span class="${className}">${escapeHtml(input.actionLabel)}</span>`;
  }

  const actionAttrs = input.openInNewTab
    ? `href="${escapeAttr(input.href)}" target="_blank" rel="noreferrer"`
    : `href="${escapeAttr(input.href)}" download`;
  const icon = input.openInNewTab
    ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.75H4.75C4.2 3.75 3.75 4.2 3.75 4.75V11.25C3.75 11.8 4.2 12.25 4.75 12.25H11.25C11.8 12.25 12.25 11.8 12.25 11.25V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.25 3.75H12.25V7.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.75 8.25L12.25 3.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : "";
  return `<a class="${className}" ${actionAttrs}>${icon}${escapeHtml(input.actionLabel)}</a>`;
}

function renderDownloadCard(input: {
  kindLabel: string;
  title: string;
  href?: string | null;
  actionLabel: string;
  previewImageUrl?: string | null;
  openInNewTab?: boolean;
  mode: RenderMode;
}) {
  const preview = input.previewImageUrl
    ? `<div class="${CARBON_FILE_CARD_PREVIEW_CLASS}"><img class="${CARBON_FILE_CARD_PREVIEW_IMAGE_CLASS}" src="${escapeAttr(input.previewImageUrl)}" alt="" loading="lazy" /></div>`
    : "";
  return `<div class="${CARBON_FILE_CARD_CLASS}">${preview}<div class="${CARBON_FILE_CARD_META_CLASS}"><div class="${CARBON_FILE_CARD_KIND_CLASS}">${escapeHtml(input.kindLabel)}</div><div class="${CARBON_FILE_CARD_TITLE_CLASS}">${escapeHtml(input.title)}</div></div>${renderCardAction({
    mode: input.mode,
    href: input.href,
    actionLabel: input.actionLabel,
    openInNewTab: input.openInNewTab,
  })}</div>`;
}

function isStandaloneBlockHtml(html: string): boolean {
  return /^(<figure\b|<div class="(?:carbon-image-node|carbon-video-node|carbon-pdf-node|share-missing-asset))/i.test(
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

function shouldSkipEmbeddedDirective(kind: string, mode: RenderMode): boolean {
  if (mode !== "pdf") return false;
  return false;
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
  const mode = input.mode ?? "share";
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

      if (shouldSkipEmbeddedDirective(kind, mode)) {
        directiveHtml.set(placeholder, "");
        return placeholder;
      }

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
            mode === "pdf"
              ? `<div class="${CARBON_VIDEO_NODE_CLASS}"><div class="${CARBON_VIDEO_FRAME_CLASS}">${renderStaticLink(title ?? asset.title ?? "Video")}</div></div>`
              : `<div class="${CARBON_VIDEO_NODE_CLASS}"><div class="${CARBON_VIDEO_FRAME_CLASS}"><video class="${CARBON_VIDEO_EMBED_CLASS}" controls preload="metadata" src="${escapeAttr(asset.publicUrl ?? "")}"></video></div></div>`,
          ),
        );
        return placeholder;
      }

      if (kind === "pdf") {
        directiveHtml.set(
          placeholder,
          renderFigure(
            null,
            mode === "pdf"
              ? `<div class="${CARBON_PDF_NODE_CLASS}"><div class="${CARBON_PDF_FRAME_CLASS}">${renderStaticLink(title ?? asset.title ?? "PDF")}</div></div>`
              : `<div class="${CARBON_PDF_NODE_CLASS}"><div class="${CARBON_PDF_FRAME_CLASS}">${renderDownloadCard({
                kindLabel: "PDF",
                title: title ?? asset.title ?? "PDF",
                href: asset.publicUrl,
                actionLabel: "Open",
                previewImageUrl: asset.previewImageUrl,
                openInNewTab: true,
                mode,
              })}</div></div>`,
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
            href: asset.publicUrl,
            actionLabel: mode === "pdf" ? "Attachment" : "Download",
            mode,
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

  renderer.link = ({ href, title, tokens }) => {
    const label = tokens ? marked.Parser.parseInline(tokens) : escapeHtml(href);
    const mappedLink = linkByHref.get(href);
    if (mappedLink?.publicUrl) {
      const className =
        mappedLink.kind === "note-link"
          ? joinClasses(CARBON_LINK_CLASS, CARBON_INTERNAL_LINK_CLASS)
          : CARBON_LINK_CLASS;
      const attrs = mode === "pdf" && mappedLink.kind !== "external-link"
        ? ""
        : ` data-href="${escapeAttr(mappedLink.publicUrl)}" href="${escapeAttr(mappedLink.publicUrl)}"`;
      const target = mappedLink.kind === "external-link" ? ' target="_blank" rel="noreferrer"' : "";
      if (mode === "pdf" && mappedLink.kind !== "external-link") {
        return mappedLink.kind === "note-link"
          ? renderStaticInternalLink(label)
          : renderStaticLink(label);
      }
      return `<a class="${className}"${attrs}${title ? ` title="${escapeAttr(title)}"` : ""}${target}>${label}</a>`;
    }

    const mappedAsset = assetUrlBySource.get(href);
    if (mappedAsset?.publicUrl && mode !== "pdf") {
      return `<a class="${CARBON_SHARE_DOWNLOAD_CLASS}" href="${escapeAttr(mappedAsset.publicUrl)}" download${title ? ` title="${escapeAttr(title)}"` : ""}>${label}</a>`;
    }

    if (mappedLink?.kind === "note-link" || isLikelyLocalMarkdownLink(href)) {
      return mode === "pdf" ? renderStaticInternalLink(label) : renderMissingLink(label, mode);
    }

    if (mappedLink?.kind === "file-link") {
      return renderStaticLink(label);
    }

    if (mode === "pdf" && !/^https?:\/\//i.test(href) && !href.startsWith("mailto:")) {
      return renderStaticLink(label);
    }

    return `<a class="${CARBON_LINK_CLASS}" data-href="${escapeAttr(href)}" href="${escapeAttr(href)}"${title ? ` title="${escapeAttr(title)}"` : ""} target="_blank" rel="noreferrer">${label}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    if (mode === "pdf" && (href.startsWith("carbon://asset/") || href.startsWith("blob:"))) {
      return "";
    }
    const asset = assetUrlBySource.get(href);
    if (!asset && href.startsWith("carbon://asset/")) {
      return renderFigure(title, renderMissingAsset("image", text || "Image unavailable"));
    }
    if (!asset && href.startsWith("blob:")) {
      return renderFigure(title, renderMissingAsset("image", text || "Image unavailable"));
    }
    const src = asset ? (asset.publicUrl ?? "") : href;
    if (!src) {
      return renderFigure(title, renderMissingAsset("image", text || "Image unavailable"));
    }
    const alt = escapeAttr(text);
    const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : "";
    return `<figure class="${CARBON_SHARE_EMBED_CLASS}"><div class="${CARBON_IMAGE_NODE_CLASS}"><div class="${CARBON_IMAGE_FRAME_CLASS}"><img class="${CARBON_IMAGE_EMBED_CLASS}" src="${escapeAttr(src)}" alt="${alt}" loading="lazy" /></div></div>${caption}</figure>`;
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
