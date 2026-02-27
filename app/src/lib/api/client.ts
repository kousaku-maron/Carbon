import { getCachedToken } from "./auth";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8787"
).replace(/\/$/, "");

export class ApiRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(body || `Request failed: ${status}`);
    this.name = "ApiRequestError";
  }
}

export async function request<T>(
  path: string,
  init?: RequestInit & { timeout?: number },
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeout ?? 10_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const hasBody = init?.body !== undefined && init?.body !== null;
  const isFormData = init?.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(hasBody && !isFormData ? { "Content-Type": "application/json" } : {}),
    ...((init?.headers as Record<string, string>) || {}),
  };

  if (getCachedToken()) {
    headers["Authorization"] = `Bearer ${getCachedToken()}`;
  }

  const res = await (async () => {
    try {
      return await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Request timeout: ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  if (!res.ok) {
    const body = await res.text();
    throw new ApiRequestError(path, res.status, body);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }

  return (await res.text()) as T;
}
