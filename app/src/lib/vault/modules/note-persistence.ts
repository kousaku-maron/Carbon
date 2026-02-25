import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Read a Markdown file and return its content as a UTF-8 string.
 */
export async function readNote(absolutePath: string): Promise<string> {
  return readTextFile(absolutePath);
}

/**
 * Write content to a Markdown file (UTF-8, overwrites existing).
 */
export async function writeNote(absolutePath: string, content: string): Promise<void> {
  // Normalize to LF
  const normalized = content.replace(/\r\n/g, "\n");
  await writeTextFile(absolutePath, normalized);
}
