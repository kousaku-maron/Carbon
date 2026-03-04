import type { Dispatch, SetStateAction } from "react";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../../types";
import {
  advanceResyncWindow,
  createFile,
  createFolder,
  fileEntry,
  flattenPaths,
  flushMicrotasks,
  Harness,
  makeEvent,
  readDirMock,
  setupSelfHealDefaults,
  watchMock,
} from "./use-file-watcher-self-heal.helpers";

describe("use-file-watcher self-heal contract: scheduling", () => {
  beforeEach(() => {
    setupSelfHealDefaults();
  });

  it(
    "resync should touch only impacted directory and keep unrelated directory state intact",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") return [fileEntry("CLI-RUNTIME-ARCHITECTURE.md")];
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [
          createFolder("/vault/docs", [createFile("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1")]),
          createFolder("/vault/notes", [createFile("/vault/notes/keep.md")]),
        ];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} />);
        });

        await act(async () => {
          await callback?.(
            makeEvent(
              { modify: { kind: "rename", mode: "to" } },
              ["/vault/docs/CLI-RUNTIME-ARCHITECTURE.md"],
            ),
          );
        });
        await advanceResyncWindow();

        const paths = flattenPaths(tree);
        expect(paths).toContain("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md");
        expect(paths).not.toContain("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1");
        expect(paths).toContain("/vault/notes/keep.md");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "move event with missing source handling should trigger old/new parent directory resync",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/from") return [];
          if (pathArg === "/vault/to") return [fileEntry("final.md")];
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [
          createFolder("/vault/from", [createFile("/vault/from/stale.tmp")]),
          createFolder("/vault/notes", [createFile("/vault/notes/keep.md")]),
          createFolder("/vault/to", []),
        ];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} />);
        });

        await act(async () => {
          await callback?.(
            makeEvent(
              { modify: { kind: "rename", mode: "both" } },
              ["/vault/from/stale.tmp", "/vault/to/final.md"],
            ),
          );
        });
        await advanceResyncWindow();

        const paths = flattenPaths(tree);
        expect(paths).toContain("/vault/notes/keep.md");
        expect(paths).toContain("/vault/to/final.md");
        expect(paths).not.toContain("/vault/from/stale.tmp");
        const oldParentReads = readDirMock.mock.calls.filter(([p]) => p === "/vault/from").length;
        const newParentReads = readDirMock.mock.calls.filter(([p]) => p === "/vault/to").length;
        expect(oldParentReads).toBeGreaterThan(0);
        expect(newParentReads).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "multiple suspicious events in the same directory should dedupe to one resync job",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") return [];
          throw new Error("ENOTDIR");
        });

        await act(async () => {
          create(
            <Harness
              vaultPath="/vault"
              setTree={vi.fn() as Dispatch<SetStateAction<TreeNode[]>>}
            />,
          );
        });

        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/a.md"]));
        });
        vi.advanceTimersByTime(100);
        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/b.md"]));
        });

        vi.advanceTimersByTime(400);
        await flushMicrotasks();

        const reads = readDirMock.mock.calls.filter(([p]) => p === "/vault/docs").length;
        expect(reads).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "suspicious events in different directories should enqueue independent resync jobs",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs" || pathArg === "/vault/notes") return [];
          throw new Error("ENOTDIR");
        });

        await act(async () => {
          create(
            <Harness
              vaultPath="/vault"
              setTree={vi.fn() as Dispatch<SetStateAction<TreeNode[]>>}
            />,
          );
        });

        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/a.md"]));
        });
        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/notes/b.md"]));
        });
        vi.advanceTimersByTime(400);
        await flushMicrotasks();

        const docsReads = readDirMock.mock.calls.filter(([p]) => p === "/vault/docs").length;
        const notesReads = readDirMock.mock.calls.filter(([p]) => p === "/vault/notes").length;
        expect(docsReads).toBe(1);
        expect(notesReads).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "resync queue should be deterministic across debounce boundaries",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") return [];
          throw new Error("ENOTDIR");
        });

        await act(async () => {
          create(
            <Harness
              vaultPath="/vault"
              setTree={vi.fn() as Dispatch<SetStateAction<TreeNode[]>>}
            />,
          );
        });

        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/a.md"]));
        });
        vi.advanceTimersByTime(100);
        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/b.md"]));
        });
        vi.advanceTimersByTime(400);
        await flushMicrotasks();

        // Same debounce window => one resync on /vault/docs
        const firstWindowReads = readDirMock.mock.calls.filter(([p]) => p === "/vault/docs").length;
        expect(firstWindowReads).toBe(1);

        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/c.md"]));
        });
        vi.advanceTimersByTime(400);
        await flushMicrotasks();

        // Next debounce window => second resync on /vault/docs
        const totalReads = readDirMock.mock.calls.filter(([p]) => p === "/vault/docs").length;
        expect(totalReads).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "non-suspicious metadata events should not schedule any directory resync probes",
    async () => {
      let callback: ((event: WatchEvent) => Promise<void>) | null = null;
      watchMock.mockImplementationOnce(async (_path, cb) => {
        callback = cb as (event: WatchEvent) => Promise<void>;
        return vi.fn();
      });

      await act(async () => {
        create(<Harness vaultPath="/vault" setTree={vi.fn() as Dispatch<SetStateAction<TreeNode[]>>} />);
      });

      await act(async () => {
        await callback?.(
          makeEvent({ modify: { kind: "metadata", mode: "write-time" } }, ["/vault/docs/a.md"]),
        );
      });

      expect(readDirMock).not.toHaveBeenCalled();
    },
  );

  it(
    "path-equivalent impacted directories should dedupe to one resync job",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") return [];
          throw new Error("ENOTDIR");
        });

        await act(async () => {
          create(
            <Harness
              vaultPath="/vault"
              setTree={vi.fn() as Dispatch<SetStateAction<TreeNode[]>>}
            />,
          );
        });

        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/a.md"]));
        });
        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs//b.md"]));
        });
        vi.advanceTimersByTime(400);
        await flushMicrotasks();

        const reads = readDirMock.mock.calls.filter(([p]) => p === "/vault/docs").length;
        expect(reads).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

});
