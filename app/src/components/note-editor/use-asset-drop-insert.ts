import type { Editor } from "@tiptap/core";
import { type DragEvent as ReactDragEvent, useCallback } from "react";
import { appendDroppedAssets, hasDroppedAssetFiles } from "../../lib/tiptap/asset-drop";

function isEditorContentTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(".tiptap, .ProseMirror");
}

export function useAssetDropInsert(editor: Editor | null, enabled: boolean) {
  const handleContentDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!enabled) {
      if (hasDroppedAssetFiles(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      }
      return;
    }
    if (isEditorContentTarget(event.target)) {
      return;
    }

    if (!hasDroppedAssetFiles(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, [enabled]);

  const handleContentDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!enabled) {
      if (hasDroppedAssetFiles(event.dataTransfer)) {
        event.preventDefault();
      }
      return;
    }
    if (!editor) return;
    if (isEditorContentTarget(event.target)) {
      return;
    }

    if (!hasDroppedAssetFiles(event.dataTransfer)) return;

    event.preventDefault();
    void appendDroppedAssets(editor, event.dataTransfer?.files);
  }, [editor, enabled]);

  return {
    handleContentDragOver,
    handleContentDrop,
  };
}
