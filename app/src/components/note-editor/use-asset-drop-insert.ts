import type { Editor } from "@tiptap/core";
import { type DragEvent as ReactDragEvent, useCallback } from "react";
import { appendDroppedAssets, hasDroppedAssetFiles } from "../../lib/tiptap/asset-drop";

export function useAssetDropInsert(editor: Editor | null, enabled: boolean) {
  const handleContentDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const hasAssetFiles = hasDroppedAssetFiles(event.dataTransfer);
    if (!enabled) {
      if (hasAssetFiles) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      }
      return;
    }

    if (!hasAssetFiles) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, [enabled]);

  const handleContentDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;

    const hasAssetFiles = hasDroppedAssetFiles(event.dataTransfer);
    if (!enabled) {
      if (hasAssetFiles) {
        event.preventDefault();
      }
      return;
    }
    if (!editor) return;

    if (!hasAssetFiles) return;

    event.preventDefault();
    const insertPos = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })?.pos;
    void appendDroppedAssets(editor, event.dataTransfer?.files, insertPos);
  }, [editor, enabled]);

  return {
    handleContentDragOver,
    handleContentDrop,
  };
}
