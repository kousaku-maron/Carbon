import type { DirEntry, WatchEvent } from "@tauri-apps/plugin-fs";
import type { TreeNode } from "../../../types";
import { vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(),
}));

import { readDir, stat, watch } from "@tauri-apps/plugin-fs";
import { useFileWatcher } from "../use-file-watcher";

const watchMock = vi.mocked(watch);
const readDirMock = vi.mocked(readDir);
const statMock = vi.mocked(stat);

type UseFileWatcherProps = Parameters<typeof useFileWatcher>[0];

function Harness(props: UseFileWatcherProps) {
  useFileWatcher(props);
  return null;
}

function makeEvent(type: WatchEvent["type"], paths: string[]): WatchEvent {
  return { type, paths, attrs: {} };
}

function createFile(path: string): TreeNode {
  const fileName = path.split("/").pop() ?? path;
  return { id: fileName, name: fileName.replace(/\.md$/i, ""), path, kind: "file" };
}

function createFolder(path: string, children: TreeNode[] = []): TreeNode {
  const folderName = path.split("/").pop() ?? path;
  return { id: folderName, name: folderName, path, kind: "folder", children };
}

function flattenPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      paths.push(item.path);
      if (item.kind === "folder" && item.children?.length) {
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return paths;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

function fileEntry(name: string): DirEntry {
  return { name, isDirectory: false } as DirEntry;
}

function dirEntry(name: string): DirEntry {
  return { name, isDirectory: true } as DirEntry;
}

async function advanceResyncWindow(): Promise<void> {
  await vi.advanceTimersByTimeAsync(400);
  await flushMicrotasks();
}

function setupSelfHealDefaults(): void {
  vi.clearAllMocks();
  readDirMock.mockRejectedValue(new Error("ENOTDIR"));
  statMock.mockResolvedValue({ isDirectory: false } as never);
}

export {
  advanceResyncWindow,
  createDeferred,
  createFile,
  createFolder,
  dirEntry,
  fileEntry,
  flattenPaths,
  flushMicrotasks,
  Harness,
  makeEvent,
  readDirMock,
  setupSelfHealDefaults,
  statMock,
  watchMock,
};
