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

function renderFigure(title: string | null | undefined, inner: string): string {
  if (!title) return `<figure class="share-embed">${inner}</figure>`;
  return `<figure class="share-embed">${inner}<figcaption>${escapeHtml(title)}</figcaption></figure>`;
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
  return `<span class="share-link share-link--missing" title="このページは公開されていません">${text}</span>`;
}

function renderMissingAsset(kind: string, label: string): string {
  const safeLabel = escapeHtml(label);

  if (kind === "image") {
    return `<div class="share-missing-asset share-missing-asset--image" role="img" aria-label="${safeLabel}">${safeLabel}</div>`;
  }

  return `<div class="share-missing-asset">${safeLabel}</div>`;
}

function buildDocumentTemplate(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f3ec;
        --panel: #fffdf8;
        --text: #201d18;
        --muted: #6e665c;
        --line: #ddd4c7;
        --accent: #0f766e;
        --missing: #9a3412;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: radial-gradient(circle at top, #fdf9ef, var(--bg));
        color: var(--text);
        font: 16px/1.7 "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
      }
      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 48px 24px 80px;
      }
      article {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 40px 32px;
        box-shadow: 0 18px 60px rgba(32, 29, 24, 0.08);
      }
      h1, h2, h3, h4, h5, h6 { line-height: 1.2; margin: 1.6em 0 0.6em; }
      h1:first-child { margin-top: 0; }
      p, ul, ol, blockquote, pre, table, figure { margin: 1em 0; }
      a { color: var(--accent); }
      img, video { max-width: 100%; border-radius: 14px; display: block; }
      code, pre {
        font-family: "SFMono-Regular", ui-monospace, "Cascadia Code", Menlo, monospace;
      }
      pre {
        overflow: auto;
        padding: 16px;
        border-radius: 14px;
        background: #1f2428;
        color: #f8f8f2;
      }
      blockquote {
        border-left: 4px solid var(--line);
        padding-left: 16px;
        color: var(--muted);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid var(--line);
        padding: 10px 12px;
      }
      figcaption {
        margin-top: 8px;
        color: var(--muted);
        font-size: 14px;
      }
      .share-link--missing {
        color: var(--missing);
        text-decoration: underline dotted;
        cursor: help;
      }
      .share-download {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .share-download::before {
        content: "↧";
      }
      .share-missing-asset {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 96px;
        padding: 18px;
        border: 1px dashed var(--line);
        border-radius: 14px;
        background: #faf7f2;
        color: var(--muted);
        font-size: 14px;
        text-align: center;
      }
      .share-missing-asset--image {
        min-height: 220px;
      }
    </style>
  </head>
  <body>
    <main>
      <article>
${bodyHtml}
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
            title,
            `<video controls preload="metadata" src="${escapeAttr(asset.publicUrl)}"></video>`,
          ),
        );
        return placeholder;
      }

      if (kind === "pdf") {
        directiveHtml.set(
          placeholder,
          renderFigure(
            title,
            `<a class="share-download" href="${escapeAttr(asset.publicUrl)}" download>PDF をダウンロード</a>`,
          ),
        );
        return placeholder;
      }

      directiveHtml.set(
        placeholder,
        renderFigure(
          title,
          `<a class="share-download" href="${escapeAttr(asset.publicUrl)}" download>ファイルをダウンロード</a>`,
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

  renderer.link = ({ href, title, tokens }) => {
    const label = tokens ? marked.Parser.parseInline(tokens) : escapeHtml(href);
    const mappedLink = linkByHref.get(href);
    if (mappedLink?.publicUrl) {
      return `<a href="${escapeAttr(mappedLink.publicUrl)}"${title ? ` title="${escapeAttr(title)}"` : ""}>${label}</a>`;
    }
    const mappedAsset = assetUrlBySource.get(href);
    if (mappedAsset) {
      return `<a class="share-download" href="${escapeAttr(mappedAsset.publicUrl)}" download${title ? ` title="${escapeAttr(title)}"` : ""}>${label}</a>`;
    }
    if (mappedLink?.kind === "note-link" || isLikelyLocalMarkdownLink(href)) {
      return renderMissingLink(label);
    }
    return `<a href="${escapeAttr(href)}"${title ? ` title="${escapeAttr(title)}"` : ""} target="_blank" rel="noreferrer">${label}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    const asset = assetUrlBySource.get(href);
    if (!asset && href.startsWith("carbon://asset/")) {
      return renderFigure(title, renderMissingAsset("image", text || "Image unavailable"));
    }
    const src = asset?.publicUrl ?? href;
    const alt = escapeAttr(text);
    const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : "";
    return `<figure class="share-embed"><img src="${escapeAttr(src)}" alt="${alt}" loading="lazy" />${caption}</figure>`;
  };

  const bodyHtml = marked.parse(markdownWithDirectives, {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  });

  return buildDocumentTemplate(input.title, bodyHtml);
}
