import { request } from "./api";

export type UploadResult = {
  assetId: string;
  assetUri: string;
  signedUrl: string;
  expiresAt: string;
};

export type ResolvedAsset = {
  assetId: string;
  url: string;
  expiresAt: string;
};

export async function uploadAsset(
  file: Blob,
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  return request<UploadResult>("/api/assets", {
    method: "POST",
    body: formData,
    timeout: 60_000,
  });
}

export async function resolveAssets(assetIds: string[]): Promise<ResolvedAsset[]> {
  if (assetIds.length === 0) return [];

  const result = await request<{ items: ResolvedAsset[] }>("/api/assets/resolve", {
    method: "POST",
    body: JSON.stringify({ assetIds }),
  });
  return result.items;
}

export async function deleteAsset(assetId: string): Promise<void> {
  await request("/api/assets/" + assetId, { method: "DELETE" });
}

// ---- Signed URL cache (client-side, in-memory) ----

const urlCache = new Map<string, { url: string; expiresAt: number }>();

const REFRESH_MARGIN_MS = 60_000; // refresh 1 minute before expiry

export function getCachedUrl(assetId: string): string | null {
  const entry = urlCache.get(assetId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt - REFRESH_MARGIN_MS) {
    urlCache.delete(assetId);
    return null;
  }
  return entry.url;
}

export function cacheUrl(assetId: string, url: string, expiresAt: string): void {
  urlCache.set(assetId, { url, expiresAt: new Date(expiresAt).getTime() });
}

export async function resolveAndCache(assetIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toResolve: string[] = [];

  for (const id of assetIds) {
    const cached = getCachedUrl(id);
    if (cached) {
      result.set(id, cached);
    } else {
      toResolve.push(id);
    }
  }

  if (toResolve.length > 0) {
    const resolved = await resolveAssets(toResolve);
    for (const item of resolved) {
      cacheUrl(item.assetId, item.url, item.expiresAt);
      result.set(item.assetId, item.url);
    }
  }

  return result;
}
