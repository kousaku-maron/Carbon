import { getRelativePath } from "../../lib/link-utils";
import type { NoteIndexEntry } from "../../lib/types";
import type { NoteLinkSuggestionItem } from "../../lib/tiptap/carbon-link-extension";

export function buildNoteLinkSuggestions(
  notes: NoteIndexEntry[],
  currentPath: string,
  query: string,
): NoteLinkSuggestionItem[] {
  const lower = query.toLowerCase();

  return notes
    .filter((file) => file.path !== currentPath)
    .filter(
      (file) =>
        !query ||
        file.name.toLowerCase().includes(lower) ||
        file.id.toLowerCase().includes(lower),
    )
    .slice(0, 20)
    .map((file) => ({
      id: file.id,
      name: file.name,
      path: file.path,
      relativePath: getRelativePath(currentPath, file.path),
    }));
}
