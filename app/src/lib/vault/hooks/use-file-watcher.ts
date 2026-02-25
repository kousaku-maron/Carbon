import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { watch } from "@tauri-apps/plugin-fs";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import { addToTree, removeFromTree, scanVault } from "../modules/note-index";
import type { TreeNode } from "../../types";

interface UseFileWatcherOptions {
  vaultPath: string | null;
  setTree: Dispatch<SetStateAction<TreeNode[]>>;
  onFileChange?: () => Promise<void>;
  onError?: (msg: string) => void;
}

export function useFileWatcher({
  vaultPath,
  setTree,
  onFileChange,
  onError,
}: UseFileWatcherOptions) {
  const latestRef = useRef({ onFileChange, onError });

  useEffect(() => {
    latestRef.current = { onFileChange, onError };
  }, [onFileChange, onError]);

  // Watch vault directory for changes
  useEffect(() => {
    if (!vaultPath) return;
    let unwatch: (() => void) | null = null;

    (async () => {
      try {
        unwatch = await watch(
          vaultPath,
          async (event: WatchEvent) => {
            const { type, paths: eventPaths } = event;

            // Content modification → refresh active note only
            if (typeof type === "object" && "modify" in type && type.modify.kind === "data") {
              await latestRef.current.onFileChange?.();
              return;
            }

            // File/folder created → incremental add
            if (typeof type === "object" && "create" in type) {
              const createKind = type.create.kind;
              if (createKind === "file" || createKind === "folder") {
                for (const p of eventPaths) {
                  setTree((prev) => addToTree(prev, p, vaultPath, createKind));
                }
                return;
              }
            }

            // File/folder removed → incremental remove
            if (typeof type === "object" && "remove" in type) {
              for (const p of eventPaths) {
                setTree((prev) => removeFromTree(prev, p));
              }
              return;
            }

            // Rename → incremental where possible
            if (typeof type === "object" && "modify" in type && type.modify.kind === "rename") {
              const mode = type.modify.mode;
              if (mode === "from") {
                for (const p of eventPaths) {
                  setTree((prev) => removeFromTree(prev, p));
                }
                return;
              }
              if (mode === "to") {
                for (const p of eventPaths) {
                  const kind = p.endsWith(".md") ? "file" as const : "folder" as const;
                  setTree((prev) => addToTree(prev, p, vaultPath, kind));
                }
                return;
              }
            }

            // Fallback: full scan
            try {
              setTree(await scanVault(vaultPath));
            } catch (err) {
              latestRef.current.onError?.(
                err instanceof Error ? err.message : "Failed to scan vault",
              );
            }
            await latestRef.current.onFileChange?.();
          },
          {
            recursive: true,
            delayMs: 500,
          },
        );
      } catch {
        // Watching is best-effort
      }
    })();

    return () => {
      unwatch?.();
    };
  }, [vaultPath, setTree]);
}
