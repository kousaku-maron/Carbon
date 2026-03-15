import { describe, expect, it } from "vitest";
import type { NoteIndexEntry } from "../../lib/types";
import type { ShareSummary } from "../../lib/share/types";
import { resolveShareSourceNoteLinkage } from "./share-linkage";

const noteIndex: NoteIndexEntry[] = [
  { id: "docs/spec.md", name: "spec", path: "/vault-a/docs/spec.md" },
  { id: "docs/spec.md", name: "spec", path: "/vault-b/docs/spec.md" },
];

const share: ShareSummary = {
  id: "sh_1",
  title: "spec",
  slug: "spec",
  shareToken: "st_1",
  publicUrl: "http://localhost:8787/s/st_1/spec",
  status: "active",
  sourceVaultPath: "/vault-a",
  sourceVaultName: "vault-a",
  sourceNotePath: "docs/spec.md",
  currentRevisionId: "shr_1",
  createdAt: "2026-03-15T00:00:00.000Z",
  updatedAt: "2026-03-15T00:00:00.000Z",
  revokedAt: null,
};

describe("resolveShareSourceNoteLinkage", () => {
  it("links only when both vault path and note path match", () => {
    const result = resolveShareSourceNoteLinkage(share, noteIndex, "/vault-a");

    expect(result.sourceNoteStatus).toBe("linked");
    expect(result.noteEntry?.path).toBe("/vault-a/docs/spec.md");
  });

  it("treats same note path in another vault as missing", () => {
    const result = resolveShareSourceNoteLinkage(share, noteIndex, "/vault-b");

    expect(result.sourceNoteStatus).toBe("missing");
    expect(result.noteEntry).toBeUndefined();
  });

  it("treats null current vault as missing", () => {
    const result = resolveShareSourceNoteLinkage(share, noteIndex, null);

    expect(result.sourceNoteStatus).toBe("missing");
    expect(result.noteEntry).toBeUndefined();
  });
});
