import { describe, expect, it, beforeEach, vi } from "vitest";
import type { WatchEvent } from "@tauri-apps/plugin-fs";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(),
}));

import { readDir, stat } from "@tauri-apps/plugin-fs";
import { __fileWatcherTestUtils } from "../use-file-watcher";
import type { TreeNode } from "../../../types";

const readDirMock = vi.mocked(readDir);
const statMock = vi.mocked(stat);

function watchEvent(type: WatchEvent["type"], paths: string[]): WatchEvent {
  return { type, paths, attrs: {} };
}

describe("use-file-watcher internals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes remove events into remove + touch ops", async () => {
    const event = watchEvent({ remove: { kind: "any" } }, ["/vault/a.md"]);

    const ops = await __fileWatcherTestUtils.normalizeWatchEvent(event);

    expect(ops).toEqual([
      { kind: "remove", path: "/vault/a.md" },
      { kind: "touch", path: "/vault/a.md" },
    ]);
  });

  it("treats string any events as remove when path is missing", async () => {
    readDirMock.mockRejectedValueOnce(new Error("ENOENT"));
    const event = watchEvent("any", ["/vault/CLI-RUNTIME-ARCHITECTURE.md.tmp.1"]);

    const ops = await __fileWatcherTestUtils.normalizeWatchEvent(event);

    expect(ops).toEqual([
      { kind: "remove", path: "/vault/CLI-RUNTIME-ARCHITECTURE.md.tmp.1" },
      { kind: "touch", path: "/vault/CLI-RUNTIME-ARCHITECTURE.md.tmp.1" },
    ]);
    expect(statMock).not.toHaveBeenCalled();
  });

  it("resolves create kind any as file when readDir reports not-directory", async () => {
    readDirMock.mockRejectedValueOnce(new Error("ENOTDIR"));
    const event = watchEvent({ create: { kind: "any" } }, ["/vault/a.txt"]);

    const ops = await __fileWatcherTestUtils.normalizeWatchEvent(event);

    expect(ops).toEqual([
      { kind: "upsert", path: "/vault/a.txt", nodeKind: "file" },
    ]);
  });

  it("normalizes rename both into move + upsert + touches", async () => {
    readDirMock.mockRejectedValueOnce(new Error("ENOTDIR"));
    const event = watchEvent(
      { modify: { kind: "rename", mode: "both" } },
      ["/vault/a.md.tmp", "/vault/a.md"],
    );

    const ops = await __fileWatcherTestUtils.normalizeWatchEvent(event);

    expect(ops).toEqual([
      { kind: "move", from: "/vault/a.md.tmp", to: "/vault/a.md" },
      { kind: "upsert", path: "/vault/a.md", nodeKind: "file" },
      { kind: "touch", path: "/vault/a.md.tmp" },
      { kind: "touch", path: "/vault/a.md" },
    ]);
  });

  it("ignores metadata-only modify events", async () => {
    const event = watchEvent(
      { modify: { kind: "metadata", mode: "write-time" } },
      ["/vault/a.md"],
    );

    const ops = await __fileWatcherTestUtils.normalizeWatchEvent(event);

    expect(ops).toEqual([]);
  });

  it("uses stat fallback for ambiguous probe failures", async () => {
    readDirMock.mockRejectedValueOnce(new Error("unexpected error"));
    statMock.mockResolvedValueOnce({ isDirectory: false } as never);
    const event = watchEvent("other", ["/vault/a.tmp"]);

    const ops = await __fileWatcherTestUtils.normalizeWatchEvent(event);

    expect(ops).toEqual([
      { kind: "upsert", path: "/vault/a.tmp", nodeKind: "file" },
      { kind: "touch", path: "/vault/a.tmp" },
    ]);
  });

  it("normalizes rename mode any via probePath", async () => {
    readDirMock.mockRejectedValueOnce(new Error("ENOENT"));
    const event = watchEvent(
      { modify: { kind: "rename", mode: "any" } },
      ["/vault/ghost.md.tmp"],
    );

    const ops = await __fileWatcherTestUtils.normalizeWatchEvent(event);

    expect(ops).toEqual([
      { kind: "remove", path: "/vault/ghost.md.tmp" },
      { kind: "touch", path: "/vault/ghost.md.tmp" },
    ]);
  });

  it("normalizes modify kind any/other via probePath", async () => {
    readDirMock.mockRejectedValueOnce(new Error("ENOTDIR"));
    readDirMock.mockRejectedValueOnce(new Error("ENOENT"));
    const anyEvent = watchEvent({ modify: { kind: "any" } }, ["/vault/a.txt"]);
    const otherEvent = watchEvent({ modify: { kind: "other" } }, ["/vault/missing.txt"]);

    const anyOps = await __fileWatcherTestUtils.normalizeWatchEvent(anyEvent);
    const otherOps = await __fileWatcherTestUtils.normalizeWatchEvent(otherEvent);

    expect(anyOps).toEqual([
      { kind: "upsert", path: "/vault/a.txt", nodeKind: "file" },
      { kind: "touch", path: "/vault/a.txt" },
    ]);
    expect(otherOps).toEqual([
      { kind: "remove", path: "/vault/missing.txt" },
      { kind: "touch", path: "/vault/missing.txt" },
    ]);
  });

  it("applies move/upsert/remove ops incrementally on tree", () => {
    const prev: TreeNode[] = [
      {
        id: "Docs",
        name: "Docs",
        path: "/vault/Docs",
        kind: "folder",
        children: [
          { id: "Docs/old.md", name: "old", path: "/vault/Docs/old.md", kind: "file" },
        ],
      },
    ];

    const next = __fileWatcherTestUtils.applyTreeOps(
      prev,
      [
        { kind: "move", from: "/vault/Docs/old.md", to: "/vault/Docs/new.md" },
        { kind: "upsert", path: "/vault/tmp.md.tmp.1", nodeKind: "file" },
        { kind: "remove", path: "/vault/tmp.md.tmp.1" },
      ],
      "/vault",
    );

    expect(next).toEqual([
      {
        id: "Docs",
        name: "Docs",
        path: "/vault/Docs",
        kind: "folder",
        children: [
          { id: "Docs/new.md", name: "new", path: "/vault/Docs/new.md", kind: "file" },
        ],
      },
    ]);
  });

  it("collects only markdown paths for content refresh", () => {
    const changed = __fileWatcherTestUtils.collectChangedMarkdownPaths([
      { kind: "touch", path: "/vault/a.md" },
      { kind: "touch", path: "/vault/a.txt" },
      { kind: "upsert", path: "/vault/b.md", nodeKind: "file" },
      { kind: "upsert", path: "/vault/b.txt", nodeKind: "file" },
      { kind: "remove", path: "/vault/c.md" },
      { kind: "move", from: "/vault/d.md", to: "/vault/d2.txt" },
    ]);

    expect(new Set(changed)).toEqual(
      new Set(["/vault/a.md", "/vault/b.md", "/vault/c.md", "/vault/d.md"]),
    );
  });

  it("collects removed and moved paths from canonical ops", () => {
    const ops: Parameters<typeof __fileWatcherTestUtils.collectRemovedPaths>[0] = [
      { kind: "remove", path: "/vault/a.md" },
      { kind: "remove", path: "/vault/a.md" },
      { kind: "move", from: "/vault/b.md", to: "/vault/c.md" },
    ];

    expect(__fileWatcherTestUtils.collectRemovedPaths(ops)).toEqual(["/vault/a.md"]);
    expect(__fileWatcherTestUtils.collectMovedPaths(ops)).toEqual([
      { from: "/vault/b.md", to: "/vault/c.md" },
    ]);
  });

  it("ignores hidden and out-of-vault directories for suspicious resync targets", () => {
    expect(__fileWatcherTestUtils.shouldIgnoreResyncPath("/vault/.git", "/vault")).toBe(true);
    expect(__fileWatcherTestUtils.shouldIgnoreResyncPath("/vault/docs/.cache", "/vault")).toBe(
      true,
    );
    expect(__fileWatcherTestUtils.shouldIgnoreResyncPath("/elsewhere/docs", "/vault")).toBe(true);
    expect(__fileWatcherTestUtils.shouldIgnoreResyncPath("/vault/docs", "/vault")).toBe(false);
    expect(__fileWatcherTestUtils.shouldIgnoreResyncPath("/vault", "/vault")).toBe(false);
  });

  it("collects only allowed suspicious resync directories", () => {
    const event = watchEvent(
      { modify: { kind: "rename", mode: "both" } },
      ["/vault/.git/tmp", "/vault/docs/final.md"],
    );
    const ops: Parameters<typeof __fileWatcherTestUtils.collectSuspiciousResyncDirs>[1] = [
      { kind: "move", from: "/vault/.git/tmp", to: "/vault/docs/final.md" },
      { kind: "upsert", path: "/vault/docs/final.md", nodeKind: "file" },
    ];

    const dirs = __fileWatcherTestUtils.collectSuspiciousResyncDirs(event, ops, "/vault");

    expect(dirs).toEqual(["/vault/docs"]);
  });
});
