import type { Editor } from "@tiptap/core";
import { type DragEvent as ReactDragEvent, useCallback } from "react";
import { appendDroppedImages, hasDroppedImageFiles } from "../../lib/tiptap/carbon-image-extension";

function isEditorContentTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(".tiptap, .ProseMirror");
}

export function useImageDropUpload(editor: Editor | null, enabled: boolean) {
  const handleContentDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!enabled) {
      if (hasDroppedImageFiles(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      }
      return;
    }
    if (isEditorContentTarget(event.target)) {
      return;
    }

    if (!hasDroppedImageFiles(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, [enabled]);

  const handleContentDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!enabled) {
      if (hasDroppedImageFiles(event.dataTransfer)) {
        event.preventDefault();
      }
      return;
    }
    if (!editor) return;
    if (isEditorContentTarget(event.target)) {
      return;
    }

    if (!hasDroppedImageFiles(event.dataTransfer)) return;

    event.preventDefault();
    void appendDroppedImages(editor, event.dataTransfer?.files);
  }, [editor, enabled]);

  return {
    handleContentDragOver,
    handleContentDrop,
  };
}
