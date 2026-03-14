import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
}));

import { readDir } from "@tauri-apps/plugin-fs";
import { addToTree, removeFromTree, scanVault } from "./note-index";
import type { TreeNode } from "../../types";

const readDirMock = vi.mocked(readDir);

describe("note-index", () => {
  it("includes root dotfolders while keeping default excluded entries hidden", async () => {
    readDirMock.mockResolvedValueOnce([
      { name: ".git", isDirectory: true },
      { name: ".claude", isDirectory: true },
      { name: ".DS_Store", isDirectory: false },
      { name: ".gitignore", isDirectory: false },
      { name: "docs", isDirectory: true },
    ] as never);
    const tree = await scanVault("/vault");

    expect(tree).toEqual([
      {
        id: ".claude",
        name: ".claude",
        path: "/vault/.claude",
        kind: "folder",
        children: [],
        loaded: false,
        dirty: false,
      },
      {
        id: "docs",
        name: "docs",
        path: "/vault/docs",
        kind: "folder",
        children: [],
        loaded: false,
        dirty: false,
      },
      { id: ".gitignore", name: ".gitignore", path: "/vault/.gitignore", kind: "file" },
    ]);
  });

  it("allows root .claude nodes while still excluding nested hidden paths and .git", () => {
    const tree: TreeNode[] = [];

    const withClaude = addToTree(tree, "/vault/.claude", "/vault", "folder");
    const withGit = addToTree(withClaude, "/vault/.git", "/vault", "folder");
    const withNestedHidden = addToTree(withGit, "/vault/node_modules/.pnpm", "/vault", "folder");

    expect(withClaude).toEqual([
      {
        id: ".claude",
        name: ".claude",
        path: "/vault/.claude",
        kind: "folder",
        children: [],
        loaded: false,
        dirty: false,
      },
    ]);
    expect(withGit).toEqual(withClaude);
    expect(withNestedHidden).toEqual(withClaude);
  });

  it("updates descendants correctly on Windows-style paths", () => {
    const tree: TreeNode[] = [
      {
        id: "Docs",
        name: "Docs",
        path: "C:\\vault\\Docs",
        kind: "folder",
        loaded: true,
        dirty: false,
        children: [
          {
            id: "Docs/a.md",
            name: "a",
            path: "C:\\vault\\Docs\\a.md",
            kind: "file",
          },
        ],
      },
    ];

    expect(addToTree(tree, "C:\\vault\\Docs\\b.md", "C:\\vault", "file")).toEqual([
      {
        id: "Docs",
        name: "Docs",
        path: "C:\\vault\\Docs",
        kind: "folder",
        loaded: true,
        dirty: false,
        children: [
          {
            id: "Docs/a.md",
            name: "a",
            path: "C:\\vault\\Docs\\a.md",
            kind: "file",
          },
          {
            id: "Docs/b.md",
            name: "b",
            path: "C:\\vault\\Docs\\b.md",
            kind: "file",
          },
        ],
      },
    ]);

    expect(removeFromTree(tree, "C:\\vault\\Docs\\a.md")).toEqual([
      {
        id: "Docs",
        name: "Docs",
        path: "C:\\vault\\Docs",
        kind: "folder",
        loaded: true,
        dirty: false,
        children: [],
      },
    ]);
  });
});
