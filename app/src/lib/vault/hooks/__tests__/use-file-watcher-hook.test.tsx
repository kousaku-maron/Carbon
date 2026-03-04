import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import type { TreeNode } from "../../../types";

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

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

function makeEvent(type: WatchEvent["type"], paths: string[]): WatchEvent {
  return { type, paths, attrs: {} };
}

function createFileNode(path: string): TreeNode {
  const fileName = path.split("/").pop() ?? path;
  return {
    id: fileName,
    path,
    kind: "file",
    name: fileName.replace(/\.md$/i, ""),
  };
}

async function mountHook(props: UseFileWatcherProps): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Harness {...props} />);
    await flushMicrotasks();
  });
  return renderer!;
}

describe("use-file-watcher hook integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readDirMock.mockRejectedValue(new Error("ENOTDIR"));
    statMock.mockResolvedValue({ isDirectory: false } as never);
  });

  it("registers watcher for a vault and unsubscribes on unmount", async () => {
    const unwatch = vi.fn();
    watchMock.mockResolvedValueOnce(unwatch);

    const renderer = await mountHook({
      vaultPath: "/vault",
      setTree: vi.fn() as Dispatch<SetStateAction<TreeNode[]>>,
    });

    expect(watchMock).toHaveBeenCalledWith(
      "/vault",
      expect.any(Function),
      { recursive: true, delayMs: 350 },
    );

    await act(async () => {
      renderer.unmount();
      await flushMicrotasks();
    });

    expect(unwatch).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes watcher when vaultPath changes", async () => {
    const unwatchA = vi.fn();
    const unwatchB = vi.fn();
    watchMock.mockResolvedValueOnce(unwatchA).mockResolvedValueOnce(unwatchB);
    const setTree = vi.fn() as Dispatch<SetStateAction<TreeNode[]>>;

    const renderer = await mountHook({
      vaultPath: "/vault-a",
      setTree,
    });

    await act(async () => {
      renderer.update(
        <Harness
          vaultPath="/vault-b"
          setTree={setTree}
        />,
      );
      await flushMicrotasks();
    });

    expect(watchMock).toHaveBeenNthCalledWith(
      1,
      "/vault-a",
      expect.any(Function),
      { recursive: true, delayMs: 350 },
    );
    expect(watchMock).toHaveBeenNthCalledWith(
      2,
      "/vault-b",
      expect.any(Function),
      { recursive: true, delayMs: 350 },
    );
    expect(unwatchA).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
      await flushMicrotasks();
    });
    expect(unwatchB).toHaveBeenCalledTimes(1);
  });

  it("does not register watcher when vaultPath is null", async () => {
    await mountHook({
      vaultPath: null,
      setTree: vi.fn() as Dispatch<SetStateAction<TreeNode[]>>,
    });

    expect(watchMock).not.toHaveBeenCalled();
  });

  it("reports watch initialization failures via onError", async () => {
    watchMock.mockRejectedValueOnce(new Error("watch startup failed"));
    const onError = vi.fn();

    await mountHook({
      vaultPath: "/vault",
      setTree: vi.fn() as Dispatch<SetStateAction<TreeNode[]>>,
      onError,
    });

    expect(onError).toHaveBeenCalledWith("Failed to watch vault: watch startup failed");
  });

  it("applies remove event and emits callbacks in order", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    let tree: TreeNode[] = [createFileNode("/vault/a.md")];
    const order: string[] = [];
    const onPathsRemoved = vi.fn(() => {
      order.push("onPathsRemoved");
    });
    const onFileChange = vi.fn(async () => {
      order.push("onFileChange");
    });
    const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
      order.push("setTree");
      tree = typeof next === "function" ? next(tree) : next;
    };

    await mountHook({
      vaultPath: "/vault",
      setTree,
      onPathsRemoved,
      onFileChange,
    });

    await act(async () => {
      await callback?.(makeEvent({ remove: { kind: "any" } }, ["/vault/a.md"]));
    });

    expect(tree).toEqual([]);
    expect(onPathsRemoved).toHaveBeenCalledWith(["/vault/a.md"]);
    expect(onFileChange).toHaveBeenCalledWith(["/vault/a.md"]);
    expect(order).toEqual(["setTree", "onPathsRemoved", "onFileChange"]);
  });

  it("uses latest callbacks after props update", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    const oldOnFileChange = vi.fn(async () => {});
    const newOnFileChange = vi.fn(async () => {});
    const setTree = vi.fn() as Dispatch<SetStateAction<TreeNode[]>>;

    const renderer = await mountHook({
      vaultPath: "/vault",
      setTree,
      onFileChange: oldOnFileChange,
    });

    await act(async () => {
      renderer.update(
        <Harness
          vaultPath="/vault"
          setTree={setTree}
          onFileChange={newOnFileChange}
        />,
      );
      await flushMicrotasks();
    });

    await act(async () => {
      await callback?.(makeEvent({ modify: { kind: "data", mode: "any" } }, ["/vault/a.md"]));
    });

    expect(oldOnFileChange).not.toHaveBeenCalled();
    expect(newOnFileChange).toHaveBeenCalledWith(["/vault/a.md"]);
  });

  it("ignores events after unmount", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    const setTree = vi.fn() as Dispatch<SetStateAction<TreeNode[]>>;
    const onPathsRemoved = vi.fn();
    const onFileChange = vi.fn(async () => {});

    const renderer = await mountHook({
      vaultPath: "/vault",
      setTree,
      onPathsRemoved,
      onFileChange,
    });

    await act(async () => {
      renderer.unmount();
      await flushMicrotasks();
    });

    await act(async () => {
      await callback?.(makeEvent({ remove: { kind: "any" } }, ["/vault/a.md"]));
    });

    expect(setTree).not.toHaveBeenCalled();
    expect(onPathsRemoved).not.toHaveBeenCalled();
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it("CURRENT behavior snapshot: keeps old node when receiving rename.to without rename.from", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    let tree: TreeNode[] = [createFileNode("/vault/old.tmp")];
    const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
      tree = typeof next === "function" ? next(tree) : next;
    };

    await mountHook({
      vaultPath: "/vault",
      setTree,
      onPathsMoved: vi.fn(),
    });

    await act(async () => {
      await callback?.(
        makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/new.md"]),
      );
    });

    // Snapshot current behavior before self-healing logic:
    // rename.to-only results in adding destination without removing stale source.
    expect(tree.map((n) => n.path).sort()).toEqual(
      ["/vault/old.tmp", "/vault/new.md"].sort(),
    );
  });

  it("emits moved callback even when move source is missing from tree", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    let tree: TreeNode[] = [];
    const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
      tree = typeof next === "function" ? next(tree) : next;
    };
    const onPathsMoved = vi.fn();

    await mountHook({
      vaultPath: "/vault",
      setTree,
      onPathsMoved,
    });

    await act(async () => {
      await callback?.(
        makeEvent(
          { modify: { kind: "rename", mode: "both" } },
          ["/vault/missing.tmp", "/vault/new.md"],
        ),
      );
    });

    expect(onPathsMoved).toHaveBeenCalledWith([
      { from: "/vault/missing.tmp", to: "/vault/new.md" },
    ]);
    expect(tree.map((n) => n.path)).toContain("/vault/new.md");
  });

  it("reports callback failures via onError", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    const onError = vi.fn();
    const onFileChange = vi.fn(async () => {
      throw new Error("boom");
    });

    await mountHook({
      vaultPath: "/vault",
      setTree: vi.fn() as Dispatch<SetStateAction<TreeNode[]>>,
      onFileChange,
      onError,
    });

    await act(async () => {
      await callback?.(makeEvent({ modify: { kind: "data", mode: "any" } }, ["/vault/a.md"]));
    });

    expect(onError).toHaveBeenCalledWith("boom");
  });

  it("reports setTree failures via onError and stops subsequent callbacks", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    const onError = vi.fn();
    const onPathsRemoved = vi.fn();
    const onFileChange = vi.fn(async () => {});
    const setTree = vi.fn(() => {
      throw new Error("set tree failed");
    }) as Dispatch<SetStateAction<TreeNode[]>>;

    await mountHook({
      vaultPath: "/vault",
      setTree,
      onPathsRemoved,
      onFileChange,
      onError,
    });

    await act(async () => {
      await callback?.(makeEvent({ remove: { kind: "any" } }, ["/vault/a.md"]));
    });

    expect(onError).toHaveBeenCalledWith("set tree failed");
    expect(onPathsRemoved).not.toHaveBeenCalled();
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it("reports onPathsRemoved failures via onError and stops subsequent callbacks", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    const onError = vi.fn();
    const onPathsRemoved = vi.fn(() => {
      throw new Error("remove callback failed");
    });
    const onFileChange = vi.fn(async () => {});

    await mountHook({
      vaultPath: "/vault",
      setTree: vi.fn() as Dispatch<SetStateAction<TreeNode[]>>,
      onPathsRemoved,
      onFileChange,
      onError,
    });

    await act(async () => {
      await callback?.(makeEvent({ remove: { kind: "any" } }, ["/vault/a.md"]));
    });

    expect(onError).toHaveBeenCalledWith("remove callback failed");
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it("reports onPathsMoved failures via onError and stops subsequent callbacks", async () => {
    let callback: ((event: WatchEvent) => Promise<void>) | null = null;
    watchMock.mockImplementationOnce(async (_path, cb) => {
      callback = cb as (event: WatchEvent) => Promise<void>;
      return vi.fn();
    });

    const onError = vi.fn();
    const onPathsMoved = vi.fn(() => {
      throw new Error("move callback failed");
    });
    const onFileChange = vi.fn(async () => {});

    await mountHook({
      vaultPath: "/vault",
      setTree: vi.fn() as Dispatch<SetStateAction<TreeNode[]>>,
      onPathsMoved,
      onFileChange,
      onError,
    });

    await act(async () => {
      await callback?.(
        makeEvent(
          { modify: { kind: "rename", mode: "both" } },
          ["/vault/old.md", "/vault/new.md"],
        ),
      );
    });

    expect(onError).toHaveBeenCalledWith("move callback failed");
    expect(onFileChange).not.toHaveBeenCalled();
  });
});
