import { describe, expect, it } from "vitest";
import { relocateInNoteIndex, removeFromNoteIndex } from "./note-catalog";
import type { NoteIndexEntry } from "../../types";

describe("note-catalog", () => {
  it("removes descendants on Windows-style paths", () => {
    const prev: NoteIndexEntry[] = [
      { id: "Docs/a.md", name: "a", path: "C:\\vault\\Docs\\a.md" },
      { id: "Docs/nested/b.md", name: "b", path: "C:\\vault\\Docs\\nested\\b.md" },
      { id: "Else/b.md", name: "b", path: "C:\\vault\\Else\\b.md" },
    ];

    expect(removeFromNoteIndex(prev, "C:\\vault\\Docs")).toEqual([
      { id: "Else/b.md", name: "b", path: "C:\\vault\\Else\\b.md" },
    ]);
  });

  it("relocates descendants on Windows-style paths", () => {
    const prev: NoteIndexEntry[] = [
      { id: "Docs/a.md", name: "a", path: "C:\\vault\\Docs\\a.md" },
      { id: "Docs/nested/b.md", name: "b", path: "C:\\vault\\Docs\\nested\\b.md" },
      { id: "Else/c.md", name: "c", path: "C:\\vault\\Else\\c.md" },
    ];

    expect(
      relocateInNoteIndex(prev, "C:\\vault\\Docs", "C:\\vault\\DocsRenamed", "C:\\vault"),
    ).toEqual([
      { id: "DocsRenamed/a.md", name: "a", path: "C:\\vault\\DocsRenamed\\a.md" },
      { id: "DocsRenamed/nested/b.md", name: "b", path: "C:\\vault\\DocsRenamed\\nested\\b.md" },
      { id: "Else/c.md", name: "c", path: "C:\\vault\\Else\\c.md" },
    ]);
  });
});
