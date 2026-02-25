import { LazyStore } from "@tauri-apps/plugin-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { request } from "./client";
import { API_BASE_URL } from "./client";

export type User = {
  id: string;
  name: string;
  email: string;
};

export type SignInResult =
  | { ok: true }
  | { ok: true; awaiting: "deeplink" }
  | { ok: false; reason: "timeout" | "error"; message?: string };

const store = new LazyStore("auth.json");
const TOKEN_KEY = "session_token";

let cachedToken: string | null = null;

export function getCachedToken(): string | null {
  return cachedToken;
}

export async function restoreToken(): Promise<void> {
  cachedToken = (await store.get<string>(TOKEN_KEY)) ?? null;
}

export async function persistToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (token) {
    await store.set(TOKEN_KEY, token);
  } else {
    await store.delete(TOKEN_KEY);
  }
}

async function pollForToken(
  code: string,
  signal: AbortSignal,
): Promise<string | null> {
  while (!signal.aborted) {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/desktop-auth/exchange?code=${encodeURIComponent(code)}`,
        { signal },
      );
      const data = await res.json();
      if (data.token) return data.token;
    } catch {
      if (signal.aborted) return null;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

export async function signInWithGoogle(
  signal?: AbortSignal,
): Promise<SignInResult> {
  if (import.meta.env.VITE_AUTH_EXCHANGE === "true") {
    const exchange = crypto.randomUUID();
    await openUrl(
      `${API_BASE_URL}/api/desktop-auth/google?exchange=${encodeURIComponent(exchange)}`,
    );

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    const timeoutId = setTimeout(() => controller.abort(), 60 * 1000);
    const token = await pollForToken(exchange, controller.signal);
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);

    if (token) {
      await persistToken(token);
      return { ok: true };
    }
    return { ok: false, reason: "timeout" };
  }

  // PROD: open browser and let deep link handle the callback
  await openUrl(`${API_BASE_URL}/api/desktop-auth/google`);
  return { ok: true, awaiting: "deeplink" };
}

export async function signOut(): Promise<void> {
  try {
    await request("/api/auth/sign-out", { method: "POST" });
  } catch {
    /* ignore sign-out errors */
  }
  await persistToken(null);
}

export async function fetchMe(): Promise<User | null> {
  try {
    const data = await request<{ user: User | null }>("/api/me");
    return data.user;
  } catch {
    return null;
  }
}
