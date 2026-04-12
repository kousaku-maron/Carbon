import {
  CARBON_PROSE_CLASS,
  CARBON_ICON_PNG_DATA_URL,
  SHARE_OG_IMAGE_HEIGHT,
  SHARE_OG_IMAGE_WIDTH,
  buildRenderedMarkdownHtml,
  buildShareDescription,
  buildSharePageTitle,
  type RenderedAssetItem,
  type RenderedLinkItem,
  resolveShareTitle,
  carbonProseCss,
} from "@carbon/rendering";

export type ShareWarning = {
  code: string;
  message: string;
  sourceRef: string;
  severity: "info" | "warning" | "error";
};

export type ShareLinkManifestItem = RenderedLinkItem;

export type ShareAssetRenderItem = RenderedAssetItem;

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
  mode?: "share" | "pdf";
}) {
  return buildDocumentTemplate(
    input.title,
    input.markdownBody,
    buildRenderedMarkdownHtml({
      markdownBody: input.markdownBody,
      assets: input.assets,
      links: input.links,
      mode: input.mode ?? "share",
    }),
    input.publicUrl,
    input.ogImageUrl,
  );
}
