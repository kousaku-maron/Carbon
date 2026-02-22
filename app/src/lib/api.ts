export type User = {
  id: string;
  name: string;
  email: string;
};

import { LazyStore } from "@tauri-apps/plugin-store";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8787").replace(/\/$/, "");

const TOKEN_KEY = "session_token";
const store = new LazyStore("auth.json");

export async function getSessionToken(): Promise<string | null> {
  return (await store.get<string>(TOKEN_KEY)) ?? null;
}

export async function setSessionToken(token: string | null): Promise<void> {
  if (token) {
    await store.set(TOKEN_KEY, token);
  } else {
    await store.delete(TOKEN_KEY);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> || {}),
  };

  const token = await getSessionToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
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
    throw new Error(body || `Request failed: ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }

  return (await res.text()) as T;
}

export async function fetchMe(): Promise<User | null> {
  const result = await request<{ user: User | null }>("/api/me", { method: "GET" });
  return result.user;
}
