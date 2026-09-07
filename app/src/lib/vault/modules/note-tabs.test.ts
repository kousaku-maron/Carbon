import { describe, expect, it } from "vitest";
import type { OpenNoteTab, TreeNode } from "../../types";
import {
  chooseActiveTabAfterRemoval,
  createOpenNoteTab,
  markOpenNoteTabsAvailable,
  markOpenNoteTabsMissing,
  relocateOpenNoteTabs,
  removeOpenNoteTabs,
  reorderOpenNoteTabs,
} from "./note-tabs";

function note(path: string, tabKey: number): OpenNoteTab {
  const name = path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
  return {
    tabKey,
    id: path.replace(/^\/vault\//, ""),
    path,
    name,
    status: "ready",
  };
}

describe("note tabs", () => {
  it("creates a ready tab from a file node", () => {
    const node: TreeNode = {
      id: "docs/a.md",
      path: "/vault/docs/a.md",
      name: "a",
      kind: "file",
    };

    expect(createOpenNoteTab(node, 7)).toEqual({
      tabKey: 7,
      id: "docs/a.md",
      path: "/vault/docs/a.md",
      name: "a",
      status: "ready",
    });
  });

  it("rebases file and folder moves while preserving tab identity and order", () => {
    const tabs = [note("/vault/docs/a.md", 1), note("/vault/keep.md", 2)];

    expect(
      relocateOpenNoteTabs(
        tabs,
        [{ from: "/vault/docs", to: "/vault/archive" }],
        "/vault",
      ),
    ).toEqual([
      {
        tabKey: 1,
        id: "archive/a.md",
        path: "/vault/archive/a.md",
        name: "a",
        status: "ready",
      },
      tabs[1],
    ]);
  });

  it("keeps externally removed tabs as missing and restores exact paths", () => {
    const tabs = [note("/vault/docs/a.md", 1), note("/vault/keep.md", 2)];
    const missing = markOpenNoteTabsMissing(tabs, ["/vault/docs"]);

    expect(missing[0].status).toBe("missing");
    expect(missing[1].status).toBe("ready");
    expect(markOpenNoteTabsAvailable(missing, ["/vault/docs/a.md"])[0].status).toBe(
      "ready",
    );
  });

  it("removes explicitly deleted descendants and selects the adjacent tab", () => {
    const tabs = [
      note("/vault/one.md", 1),
      note("/vault/docs/two.md", 2),
      note("/vault/three.md", 3),
    ];
    const next = removeOpenNoteTabs(tabs, ["/vault/docs"]);

    expect(next.map((tab) => tab.tabKey)).toEqual([1, 3]);
    expect(chooseActiveTabAfterRemoval(tabs, next, 2)).toBe(3);
  });

  it("reorders a tab before or after the drop target", () => {
    const tabs = [note("/vault/one.md", 1), note("/vault/two.md", 2), note("/vault/three.md", 3)];

    expect(reorderOpenNoteTabs(tabs, 1, 3, "after").map((tab) => tab.tabKey)).toEqual([
      2,
      3,
      1,
    ]);
    expect(reorderOpenNoteTabs(tabs, 3, 1, "before").map((tab) => tab.tabKey)).toEqual([
      3,
      1,
      2,
    ]);
  });
});
