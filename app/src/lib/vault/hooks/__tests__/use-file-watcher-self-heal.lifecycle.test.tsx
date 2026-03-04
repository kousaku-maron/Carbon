import type { Dispatch, SetStateAction } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry, WatchEvent } from "@tauri-apps/plugin-fs";
import type { TreeNode } from "../../../types";
import {
  advanceResyncWindow,
  createDeferred,
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

describe("use-file-watcher self-heal contract: lifecycle", () => {
  beforeEach(() => {
    setupSelfHealDefaults();
  });

  it(
    "newer resync result should win when an older same-directory job is still in-flight",
    async () => {
      vi.useFakeTimers();
      try {
        const deferred = createDeferred<DirEntry[]>();
        let docsReads = 0;
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg !== "/vault/docs") throw new Error("ENOTDIR");
          docsReads += 1;
          if (docsReads === 1) return deferred.promise;
          return [fileEntry("v2.md")];
        });

        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        let tree: TreeNode[] = [createFolder("/vault/docs", [])];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} />);
        });

        if (!callback) {
          throw new Error("watch callback was not captured");
        }
        const callbackFn = callback as (event: WatchEvent) => Promise<void>;
        await act(async () => {
          await callbackFn(
            makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/v1.md"]),
          );
        });
        await advanceResyncWindow();

        await act(async () => {
          await callbackFn(
            makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/v2.md"]),
          );
        });
        await advanceResyncWindow();

        deferred.resolve([]);
        await flushMicrotasks();

        const paths = flattenPaths(tree);
        expect(paths).toContain("/vault/docs/v2.md");
        expect(paths).not.toContain("/vault/docs/v1.md");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "in-flight resync result should be discarded after unmount",
    async () => {
      vi.useFakeTimers();
      try {
        const deferred = createDeferred<DirEntry[]>();
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault") return deferred.promise;
          throw new Error("ENOTDIR");
        });

        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        const setTreeMock = vi.fn();
        const setTree = setTreeMock as unknown as Dispatch<SetStateAction<TreeNode[]>>;
        let renderer: ReactTestRenderer;
        await act(async () => {
          renderer = create(<Harness vaultPath="/vault" setTree={setTree} />);
        });

        if (!callback) {
          throw new Error("watch callback was not captured");
        }
        const callbackFn = callback as (event: WatchEvent) => Promise<void>;
        await act(async () => {
          await callbackFn(
            makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/slow.md"]),
          );
        });
        setTreeMock.mockClear();
        await advanceResyncWindow();

        await act(async () => {
          renderer!.unmount();
        });

        deferred.resolve([]);
        await flushMicrotasks();

        expect(setTreeMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "in-flight resync result should be discarded after vault switch",
    async () => {
      vi.useFakeTimers();
      try {
        const deferred = createDeferred<DirEntry[]>();
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault-a") return deferred.promise;
          if (pathArg === "/vault-b") return [];
          throw new Error("ENOTDIR");
        });

        let callbackA: ((event: WatchEvent) => Promise<void>) | null = null;
        let callbackB: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock
          .mockImplementationOnce(async (_path, cb) => {
            callbackA = cb as (event: WatchEvent) => Promise<void>;
            return vi.fn();
          })
          .mockImplementationOnce(async (_path, cb) => {
            callbackB = cb as (event: WatchEvent) => Promise<void>;
            return vi.fn();
          });

        const setTreeMock = vi.fn();
        const setTree = setTreeMock as unknown as Dispatch<SetStateAction<TreeNode[]>>;
        let renderer: ReactTestRenderer;
        await act(async () => {
          renderer = create(<Harness vaultPath="/vault-a" setTree={setTree} />);
          await flushMicrotasks();
        });

        if (!callbackA) {
          throw new Error("watch callback for vault-a was not captured");
        }
        const callbackForVaultA = callbackA as (event: WatchEvent) => Promise<void>;
        await act(async () => {
          await callbackForVaultA(
            makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault-a/slow.md"]),
          );
        });
        setTreeMock.mockClear();
        await advanceResyncWindow();

        await act(async () => {
          renderer!.update(<Harness vaultPath="/vault-b" setTree={setTree} />);
          await flushMicrotasks();
        });

        deferred.resolve([]);
        await flushMicrotasks();

        expect(callbackB).not.toBeNull();
        expect(setTreeMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

});
