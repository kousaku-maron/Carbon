import { getCachedToken } from "../../api/auth";

// ── Types ──────────────────────────────────────────────────────

export type UploadResult = {
  assetId: string;
  assetUri: string;
  signedUrl: string;
  expiresAt: string;
};

type ResolvedAsset = {
  assetId: string;
  url: string;
  expiresAt: string;
};

// ── HTTP helper ────────────────────────────────────────────────

async function assetFetch<T>(
  apiUrl: string,
  path: string,
  init?: RequestInit & { timeout?: number },
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeout ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isFormData = init?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
  };

  if (getCachedToken()) headers.Authorization = `Bearer ${getCachedToken()}`;

  try {
    const res = await fetch(`${apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
    if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
    return res.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timeout: ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ── Upload ─────────────────────────────────────────────────────

export async function uploadAsset(apiUrl: string, file: Blob): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  return assetFetch<UploadResult>(apiUrl, "/api/assets", {
    method: "POST",
    body: formData,
    timeout: 60_000,
  });
}

// ── Resolve ────────────────────────────────────────────────────

async function resolveAssets(apiUrl: string, assetIds: string[]): Promise<ResolvedAsset[]> {
  if (assetIds.length === 0) return [];
  const result = await assetFetch<{ items: ResolvedAsset[] }>(apiUrl, "/api/assets/resolve", {
    method: "POST",
    body: JSON.stringify({ assetIds }),
    timeout: 20_000,
  });
  return result.items;
}

// ── Signed URL cache (in-memory) ──────────────────────────────

const urlCache = new Map<string, { url: string; expiresAt: number }>();
const REFRESH_MARGIN_MS = 60_000;

export function cacheUrl(assetId: string, url: string, expiresAt: string): void {
  urlCache.set(assetId, { url, expiresAt: new Date(expiresAt).getTime() });
}

function getCachedUrl(assetId: string): string | null {
  const entry = urlCache.get(assetId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt - REFRESH_MARGIN_MS) {
    urlCache.delete(assetId);
    return null;
  }
  return entry.url;
}

export async function resolveAndCache(
  apiUrl: string,
  assetIds: string[],
): Promise<Map<string, string>> {
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
    const resolved = await resolveAssets(apiUrl, toResolve);
    for (const item of resolved) {
      cacheUrl(item.assetId, item.url, item.expiresAt);
      result.set(item.assetId, item.url);
    }
  }

  return result;
}
