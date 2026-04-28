import { resolveShareTitle } from "@carbon/rendering";
import { getImageMimeType, getVideoMimeType, isImagePath, isMarkdownPath, isPdfPath, isVideoPath } from "../file-kind";
import { resolveVaultLocalPath } from "../link-utils";
import { getBaseName, isPathInside } from "../path-utils";
import type { ShareAnalysis, ShareAssetManifestItem, ShareLinkManifestItem, ShareWarning } from "./types";

type AnalyzeShareInputOptions = {
  noteId: string;
  notePath: string;
  vaultPath: string;
  markdownBody: string;
  title?: string;
};

function stripCodeLikeSegments(markdown: string): string {
  return markdown
    // fenced code blocks
    .replace(/```[\s\S]*?```/g, "")
    // inline code spans
    .replace(/`[^`\n]+`/g, "");
}

function hasUriScheme(src: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(src);
}

function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function isLocalReference(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:") || src.startsWith("blob:")) return false;
  if (src.startsWith("carbon://asset/")) return false;
  if (/^https?:\/\//i.test(src)) return false;
  return !hasUriScheme(src) || isWindowsAbsolutePath(src);
}

function resolveLocalAbsolutePath(currentNotePath: string, href: string, vaultPath: string): string {
  if (isWindowsAbsolutePath(href)) return href;
  return resolveVaultLocalPath(currentNotePath, href, vaultPath);
}

function getMimeType(path: string): string {
  if (isImagePath(path)) return getImageMimeType(path);
  if (isVideoPath(path)) return getVideoMimeType(path);
  if (isPdfPath(path)) return "application/pdf";
  return "application/octet-stream";
}

function getAssetKind(path: string): ShareAssetManifestItem["kind"] {
  if (isImagePath(path)) return "image";
  if (isVideoPath(path)) return "video";
  if (isPdfPath(path)) return "pdf";
  return "file";
}

const CURRENT_SUPPORTED_CARBON_ASSET_KINDS = new Set<ShareAssetManifestItem["kind"]>(["image"]);

function getDirectiveAssetKind(kind: string): ShareAssetManifestItem["kind"] {
  if (kind === "video") return "video";
  if (kind === "pdf") return "pdf";
  if (kind === "image") return "image";
  return "file";
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

export function analyzeShareInput(options: AnalyzeShareInputOptions): ShareAnalysis {
  const markdownForScan = stripCodeLikeSegments(options.markdownBody);
  const warnings: ShareWarning[] = [];
  const assetManifest = new Map<string, ShareAssetManifestItem>();
  const localUploads = new Map<
    string,
    {
      fieldName: string;
      absolutePath: string;
      fileName: string;
      mimeType: string;
    }
  >();
  const linkManifest = new Map<string, ShareLinkManifestItem>();

  function addWarning(warning: ShareWarning) {
    const key = `${warning.code}:${warning.sourceRef}`;
    if (warnings.some((item) => `${item.code}:${item.sourceRef}` === key)) return;
    warnings.push(warning);
  }

  function addLocalAsset(sourceRef: string, title: string | null | undefined) {
    const absolutePath = resolveLocalAbsolutePath(options.notePath, sourceRef, options.vaultPath);
    if (!isPathInside(absolutePath, options.vaultPath)) {
      addWarning({
        code: "OUTSIDE_VAULT_ASSET",
        message: "Vault 外のファイル参照があるため共有できません",
        sourceRef,
        severity: "error",
      });
      return;
    }

    const existing = assetManifest.get(sourceRef);
    if (existing) return existing;

    const clientAssetId = crypto.randomUUID();
    const uploadField = `file_${clientAssetId}`;
    const mimeType = getMimeType(absolutePath);
    const manifest: ShareAssetManifestItem = {
      clientAssetId,
      kind: getAssetKind(absolutePath),
      sourceType: "local-file",
      sourceRef,
      mimeType,
      title: title ?? null,
      uploadField,
    };
    assetManifest.set(sourceRef, manifest);
    localUploads.set(uploadField, {
      fieldName: uploadField,
      absolutePath,
      fileName: getBaseName(absolutePath),
      mimeType,
    });
    return manifest;
  }

  function addCarbonAsset(
    sourceRef: string,
    title: string | null | undefined,
    kind: ShareAssetManifestItem["kind"],
  ) {
    if (!CURRENT_SUPPORTED_CARBON_ASSET_KINDS.has(kind)) {
      addWarning({
        code: "UNSUPPORTED_CARBON_ASSET_KIND",
        message: "carbon://asset 共有は現在画像のみ対応しています",
        sourceRef,
        severity: "error",
      });
      return;
    }

    if (assetManifest.has(sourceRef)) return assetManifest.get(sourceRef)!;
    const manifest: ShareAssetManifestItem = {
      clientAssetId: crypto.randomUUID(),
      kind,
      sourceType: "carbon-asset",
      sourceRef,
      mimeType: "application/octet-stream",
      title: title ?? null,
    };
    assetManifest.set(sourceRef, manifest);
    return manifest;
  }

  for (const match of markdownForScan.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g)) {
    const [, _alt, src, title] = match;
    if (src.startsWith("carbon://asset/")) {
      addCarbonAsset(src, title, "image");
      continue;
    }
    if (isLocalReference(src)) {
      addLocalAsset(src, title);
    }
  }

  for (const match of markdownForScan.matchAll(/:::([a-z]+)\s*\{([^}]*)\}\s*:::/g)) {
    const [, rawKind, attrsRaw] = match;
    const attrs = parseDirectiveAttributes(attrsRaw);
    const src = attrs.src ?? "";
    const title = attrs.title ?? null;
    if (!src) continue;
    if (src.startsWith("carbon://asset/")) {
      addCarbonAsset(src, title, getDirectiveAssetKind(rawKind));
      continue;
    }
    if (isLocalReference(src)) {
      addLocalAsset(src, title);
    }
  }

  for (const match of markdownForScan.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g)) {
    const [, _label, href, title] = match;
    if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) {
      linkManifest.set(href, { href, kind: "external-link" });
      continue;
    }
    if (href.startsWith("carbon://asset/")) {
      addCarbonAsset(href, title, "file");
      continue;
    }
    if (!isLocalReference(href)) continue;

    const absolutePath = resolveLocalAbsolutePath(options.notePath, href, options.vaultPath);
    if (!isPathInside(absolutePath, options.vaultPath)) {
      addWarning({
        code: "OUTSIDE_VAULT_LINK",
        message: "Vault 外のファイル参照があるため共有できません",
        sourceRef: href,
        severity: "error",
      });
      continue;
    }

    if (isMarkdownPath(absolutePath)) {
      const targetNotePath = absolutePath.slice(options.vaultPath.replace(/[\\/]+$/, "").length + 1).replace(/\\/g, "/");
      linkManifest.set(href, { href, kind: "note-link", targetNotePath });
      addWarning({
        code: "UNSHARED_NOTE_LINK",
        message: "リンク先ノートは未公開の可能性があります",
        sourceRef: href,
        severity: "warning",
      });
      continue;
    }

    addLocalAsset(href, title);
    linkManifest.set(href, { href, kind: "file-link" });
  }

  return {
    metadata: {
      title: resolveShareTitle(options.markdownBody, options.title?.trim() || "Untitled"),
      sourceVaultPath: options.vaultPath,
      sourceVaultName: getBaseName(options.vaultPath),
      sourceNotePath: options.noteId,
      markdownBody: options.markdownBody,
      linkManifest: [...linkManifest.values()],
      assetManifest: [...assetManifest.values()],
      warnings,
    },
    localUploads: [...localUploads.values()],
  };
}
