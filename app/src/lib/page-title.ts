import { invoke } from "@tauri-apps/api/core";

/** Resolve a public HTTP(S) page title through the native app process. */
export async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    return await invoke<string | null>("fetch_page_title", { url });
  } catch {
    return null;
  }
}
