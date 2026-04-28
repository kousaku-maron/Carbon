import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { getBaseName, joinPath, toVaultRelative } from "../path-utils";

const LOCAL_ASSET_DIR = ".carbon/assets";

function getAssetExtension(file: File): string {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  if (file.type === "image/svg+xml") return "svg";
  if (file.type === "image/avif") return "avif";
  if (file.type === "video/mp4") return "mp4";
  if (file.type === "video/webm") return "webm";
  if (file.type === "video/quicktime") return "mov";
  if (file.type === "video/ogg") return "ogv";
  if (file.type === "application/pdf") return "pdf";
  const extension = getBaseName(file.name).match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (extension) return extension;
  return "bin";
}

function createLocalAssetFileName(file: File): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${Date.now()}-${id}.${getAssetExtension(file)}`;
}

export async function saveFileToVaultAssets(input: {
  file: File;
  vaultPath: string;
}): Promise<{ absolutePath: string; markdownPath: string }> {
  const assetDir = LOCAL_ASSET_DIR
    .split("/")
    .reduce((parent, segment) => joinPath(parent, segment), input.vaultPath);
  const absolutePath = joinPath(assetDir, createLocalAssetFileName(input.file));
  const bytes = new Uint8Array(await input.file.arrayBuffer());

  await mkdir(assetDir, { recursive: true });
  await writeFile(absolutePath, bytes);

  return {
    absolutePath,
    markdownPath: `/${toVaultRelative(absolutePath, input.vaultPath).replace(/^\/+/, "")}`,
  };
}
