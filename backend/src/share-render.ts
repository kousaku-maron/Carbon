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
  CARBON_PROSE_CLASS,
  CARBON_SHARE_DOWNLOAD_CLASS,
  CARBON_SHARE_EMBED_CLASS,
  CARBON_SHARE_OPEN_CLASS,
  CARBON_VIDEO_EMBED_CLASS,
  CARBON_VIDEO_FRAME_CLASS,
  CARBON_VIDEO_NODE_CLASS,
  CARBON_ICON_PNG_DATA_URL,
  SHARE_OG_IMAGE_HEIGHT,
  SHARE_OG_IMAGE_WIDTH,
  buildShareDescription,
  buildSharePageTitle,
  resolveShareTitle,
  carbonProseCss,
} from "@carbon/rendering";
import { marked } from "marked";

export type ShareWarning = {
  code: string;
  message: string;
  sourceRef: string;
  severity: "info" | "warning" | "error";
};

export type ShareLinkManifestItem = {
  href: string;
  kind: "note-link" | "file-link" | "external-link";
  targetNotePath?: string | null;
  publicUrl?: string | null;
};

export type ShareAssetRenderItem = {
  kind: string;
  sourceRef: string;
  title?: string | null;
  publicUrl: string;
  previewImageUrl?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function renderMissingLink(text: string): string {
  return `<span class="${joinClasses(CARBON_LINK_CLASS, CARBON_INTERNAL_LINK_CLASS, CARBON_MISSING_LINK_CLASS)}" data-href="" data-tooltip="This page is not published" aria-disabled="true" title="This page is not published">${text}</span>`;
}

function renderMissingAsset(kind: string, label: string): string {
  const safeLabel = escapeHtml(label);

  if (kind === "image") {
    return `<div class="${joinClasses(CARBON_MISSING_ASSET_CLASS, CARBON_MISSING_IMAGE_ASSET_CLASS)}" role="img" aria-label="${safeLabel}">${safeLabel}</div>`;
  }

  return `<div class="${CARBON_MISSING_ASSET_CLASS}">${safeLabel}</div>`;
}

function renderDownloadCard(input: {
  kindLabel: string;
  title: string;
  href: string;
  actionLabel: string;
  previewImageUrl?: string | null;
  openInNewTab?: boolean;
}) {
  const preview = input.previewImageUrl
    ? `<div class="${CARBON_FILE_CARD_PREVIEW_CLASS}"><img class="${CARBON_FILE_CARD_PREVIEW_IMAGE_CLASS}" src="${escapeAttr(input.previewImageUrl)}" alt="" loading="lazy" /></div>`
    : "";
  const actionAttrs = input.openInNewTab
    ? `href="${escapeAttr(input.href)}" target="_blank" rel="noreferrer"`
    : `href="${escapeAttr(input.href)}" download`;
  const icon = input.openInNewTab
    ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.75H4.75C4.2 3.75 3.75 4.2 3.75 4.75V11.25C3.75 11.8 4.2 12.25 4.75 12.25H11.25C11.8 12.25 12.25 11.8 12.25 11.25V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.25 3.75H12.25V7.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.75 8.25L12.25 3.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : "";
  return `<div class="${CARBON_FILE_CARD_CLASS}">${preview}<div class="${CARBON_FILE_CARD_META_CLASS}"><div class="${CARBON_FILE_CARD_KIND_CLASS}">${escapeHtml(input.kindLabel)}</div><div class="${CARBON_FILE_CARD_TITLE_CLASS}">${escapeHtml(input.title)}</div></div><a class="${joinClasses(CARBON_FILE_CARD_ACTION_CLASS, input.openInNewTab ? CARBON_SHARE_OPEN_CLASS : CARBON_SHARE_DOWNLOAD_CLASS)}" ${actionAttrs}>${icon}${escapeHtml(input.actionLabel)}</a></div>`;
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
  const bodyTokens = (tokens ?? []).filter((token) => token.type !== "checkbox");
  const html = bodyTokens.length > 0
    ? String(marked.Parser.parse(bodyTokens as never, { renderer }))
    : "";
  if (!html) return "<p></p>";
  return isBlockHtml(html) ? html : `<p>${html}</p>`;
}

function buildDocumentTemplate(
  noteTitle: string,
  markdownBody: string,
  bodyHtml: string,
  publicUrl?: string | null,
  ogImageUrl?: string | null,
): string {
  const pageTitle = buildSharePageTitle(resolveShareTitle(markdownBody, noteTitle));
  const description = buildShareDescription(markdownBody);
  const twitterCardType = ogImageUrl ? "summary_large_image" : "summary";
  const canonicalMeta = publicUrl
    ? `
    <link rel="canonical" href="${escapeAttr(publicUrl)}" />
    <meta property="og:url" content="${escapeAttr(publicUrl)}" />`
    : "";
  const ogImageMeta = ogImageUrl
    ? `
    <meta property="og:image" content="${escapeAttr(ogImageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeAttr(ogImageUrl)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="${SHARE_OG_IMAGE_WIDTH}" />
    <meta property="og:image:height" content="${SHARE_OG_IMAGE_HEIGHT}" />
    <meta property="og:image:alt" content="${escapeAttr(pageTitle)}" />
    <meta name="twitter:image" content="${escapeAttr(ogImageUrl)}" />`
    : "";

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <link rel="icon" type="image/png" href="${CARBON_ICON_PNG_DATA_URL}" />
    <meta name="description" content="${escapeAttr(description)}" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
${canonicalMeta}
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Carbon" />
    <meta property="og:title" content="${escapeAttr(pageTitle)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
${ogImageMeta}
    <meta name="twitter:card" content="${twitterCardType}" />
    <meta name="twitter:title" content="${escapeAttr(pageTitle)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <style>
      :root {
        color-scheme: light;
        --text: #37352f;
      }
      * { box-sizing: border-box; }
      html {
        background: #ffffff;
      }
      body {
        margin: 0;
        background: #ffffff;
        color: var(--text);
        font-family: "IBM Plex Sans", "Noto Sans JP", sans-serif;
      }
      main {
        min-height: 100vh;
        padding: 1.25rem 1.25rem clamp(14rem, 48vh, 26rem);
      }
      article {
        max-width: 720px;
        width: 100%;
        margin: 0 auto;
      }
      ${carbonProseCss}
    </style>
  </head>
  <body>
    <main>
      <article class="${CARBON_PROSE_CLASS}">
${bodyHtml}
      </article>
    </main>
  </body>
</html>`;
}

export function buildRevokedHtml(): string {
  const pageTitle = buildSharePageTitle("Share unavailable");
  const description = "This shared page is no longer available.";

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <link rel="icon" type="image/png" href="${CARBON_ICON_PNG_DATA_URL}" />
    <meta name="description" content="${escapeAttr(description)}" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <meta property="og:site_name" content="Carbon" />
    <meta property="og:title" content="${escapeAttr(pageTitle)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeAttr(pageTitle)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f3ef;
        --bg-dot: rgba(17, 24, 39, 0.12);
        --card: rgba(255, 255, 255, 0.92);
        --border: rgba(24, 24, 27, 0.12);
        --text: #111827;
        --muted: #5b6474;
        --accent: #111111;
      }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        color: var(--text);
        font-family: "IBM Plex Sans", "Noto Sans JP", sans-serif;
        background-color: var(--bg);
        background-image: radial-gradient(circle at 1px 1px, var(--bg-dot) 1.1px, transparent 0);
        background-size: 42px 42px;
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      article {
        width: min(100%, 720px);
        padding: clamp(28px, 5vw, 44px);
        border-radius: 28px;
        border: 1px solid var(--border);
        background: var(--card);
        box-shadow: 0 24px 72px rgba(15, 23, 42, 0.08);
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 28px;
        font-size: 1.75rem;
        line-height: 1;
        color: #374151;
      }
      .brand img {
        width: 40px;
        height: 40px;
        border-radius: 10px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 0.4rem 0.72rem;
        border-radius: 999px;
        background: #111111;
        color: #ffffff;
        font-size: 0.78rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 14px;
        font-size: clamp(2rem, 6vw, 3.6rem);
        line-height: 1.04;
        letter-spacing: -0.04em;
      }
      p {
        max-width: 34rem;
        margin: 0;
        font-size: clamp(1rem, 2.4vw, 1.15rem);
        line-height: 1.75;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <div class="brand">
          <img src="${CARBON_ICON_PNG_DATA_URL}" alt="" />
          <span>Carbon</span>
        </div>
        <div class="badge">410 Gone</div>
        <h1>This share has been revoked.</h1>
        <p>This page is no longer publicly available. If you still need access, ask the author for a new share link.</p>
      </article>
    </main>
  </body>
</html>`;
}

export function buildRenderedHtml(input: {
  title: string;
  markdownBody: string;
  assets: ShareAssetRenderItem[];
  links: ShareLinkManifestItem[];
  publicUrl?: string | null;
  ogImageUrl?: string | null;
}) {
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
      const placeholder = `<!--__SHARE_BLOCK_${directiveIndex++}__-->`;

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
            `<div class="${CARBON_VIDEO_NODE_CLASS}"><div class="${CARBON_VIDEO_FRAME_CLASS}"><video class="${CARBON_VIDEO_EMBED_CLASS}" controls preload="metadata" src="${escapeAttr(asset.publicUrl)}"></video></div></div>`,
          ),
        );
        return placeholder;
      }

      if (kind === "pdf") {
        const resolvedTitle = title ?? asset.title ?? "PDF";
        directiveHtml.set(
          placeholder,
          renderFigure(
            null,
            `<div class="${CARBON_PDF_NODE_CLASS}"><div class="${CARBON_PDF_FRAME_CLASS}">${renderDownloadCard({
              kindLabel: "PDF",
              title: resolvedTitle,
              href: asset.publicUrl,
              actionLabel: "Open",
              previewImageUrl: asset.previewImageUrl,
              openInNewTab: true,
            })}</div></div>`,
          ),
        );
        return placeholder;
      }

      const resolvedTitle = title ?? asset.title ?? "File";
      directiveHtml.set(
        placeholder,
        renderFigure(
          null,
          renderDownloadCard({
            kindLabel: "File",
            title: resolvedTitle,
            href: asset.publicUrl,
            actionLabel: "Download",
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
      return `<a class="${className}" data-href="${escapeAttr(mappedLink.publicUrl)}" href="${escapeAttr(mappedLink.publicUrl)}"${title ? ` title="${escapeAttr(title)}"` : ""}>${label}</a>`;
    }
    const mappedAsset = assetUrlBySource.get(href);
    if (mappedAsset) {
      return `<a class="${CARBON_SHARE_DOWNLOAD_CLASS}" href="${escapeAttr(mappedAsset.publicUrl)}" download${title ? ` title="${escapeAttr(title)}"` : ""}>${label}</a>`;
    }
    if (mappedLink?.kind === "note-link" || isLikelyLocalMarkdownLink(href)) {
      return renderMissingLink(label);
    }
    return `<a class="${CARBON_LINK_CLASS}" data-href="${escapeAttr(href)}" href="${escapeAttr(href)}"${title ? ` title="${escapeAttr(title)}"` : ""} target="_blank" rel="noreferrer">${label}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    const asset = assetUrlBySource.get(href);
    if (!asset && href.startsWith("carbon://asset/")) {
      return renderFigure(title, renderMissingAsset("image", text || "Image unavailable"));
    }
    const src = asset?.publicUrl ?? href;
    const alt = escapeAttr(text);
    const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : "";
    return `<figure class="${CARBON_SHARE_EMBED_CLASS}"><div class="${CARBON_IMAGE_NODE_CLASS}"><div class="${CARBON_IMAGE_FRAME_CLASS}"><img class="${CARBON_IMAGE_EMBED_CLASS}" src="${escapeAttr(src)}" alt="${alt}" loading="lazy" /></div></div>${caption}</figure>`;
  };

  const bodyHtml = marked.parse(markdownWithDirectives, {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  });

  let resolvedBodyHtml = bodyHtml;
  for (const [placeholder, html] of directiveHtml) {
    resolvedBodyHtml = resolvedBodyHtml.replaceAll(placeholder, html);
    resolvedBodyHtml = resolvedBodyHtml.replaceAll(escapeHtml(placeholder), html);
  }

  return buildDocumentTemplate(
    input.title,
    input.markdownBody,
    resolvedBodyHtml,
    input.publicUrl,
    input.ogImageUrl,
  );
}
