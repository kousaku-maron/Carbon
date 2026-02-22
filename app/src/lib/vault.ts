import { open } from "@tauri-apps/plugin-dialog";
import { LazyStore } from "@tauri-apps/plugin-store";

const VAULT_KEY = "vault_path";
const VAULT_HISTORY_KEY = "vault_history";
const store = new LazyStore("settings.json");

/**
 * Retrieve the persisted active vault path, or null if none set.
 */
export async function getVaultPath(): Promise<string | null> {
  return (await store.get<string>(VAULT_KEY)) ?? null;
}

/**
 * Persist the active vault path and add it to the history.
 */
export async function setVaultPath(path: string): Promise<void> {
  await store.set(VAULT_KEY, path);
  await addToHistory(path);
}

/**
 * Get the list of previously selected vault paths (most recent first).
 */
export async function getVaultHistory(): Promise<string[]> {
  return (await store.get<string[]>(VAULT_HISTORY_KEY)) ?? [];
}

/**
 * Remove a vault path from the history.
 */
export async function removeFromHistory(path: string): Promise<void> {
  const history = await getVaultHistory();
  const updated = history.filter((p) => p !== path);
  await store.set(VAULT_HISTORY_KEY, updated);
}

async function addToHistory(path: string): Promise<void> {
  const history = await getVaultHistory();
  const updated = [path, ...history.filter((p) => p !== path)];
  await store.set(VAULT_HISTORY_KEY, updated);
}

/**
 * Open a native folder-picker dialog and return the selected path,
 * or null if the user cancelled.
 */
export async function pickVaultFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select Vault Folder",
  });
  return selected ?? null;
}
