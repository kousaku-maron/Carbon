import { normalizeForCompare } from "../../lib/path-utils";
import type { NoteIndexEntry } from "../../lib/types";
import type { ShareSourceNoteStatus, ShareSummary } from "../../lib/share/types";

export function resolveShareSourceNoteLinkage(
  share: ShareSummary,
  noteIndex: NoteIndexEntry[],
  currentVaultPath: string | null,
): {
  sourceNoteStatus: ShareSourceNoteStatus;
  noteEntry?: NoteIndexEntry;
} {
  const noteEntry = noteIndex.find((entry) => {
    if (entry.id !== share.sourceNotePath) return false;
    if (!currentVaultPath) return false;
    return normalizeForCompare(share.sourceVaultPath) === normalizeForCompare(currentVaultPath);
  });

  return {
    sourceNoteStatus: noteEntry ? "linked" : "missing",
    noteEntry,
  };
}
