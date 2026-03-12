import type { Editor } from "@tiptap/core";
import { type DragEvent as ReactDragEvent, useCallback } from "react";
import { appendDroppedImages, hasDroppedImageFiles } from "../../lib/tiptap/carbon-image-extension";

function isEditorContentTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(".tiptap, .ProseMirror");
}

export function useImageDropUpload(editor: Editor | null) {
  const handleContentDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (isEditorContentTarget(event.target)) {
      return;
    }

    if (!hasDroppedImageFiles(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleContentDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!editor) return;
    if (isEditorContentTarget(event.target)) {
      return;
    }

    if (!hasDroppedImageFiles(event.dataTransfer)) return;

    event.preventDefault();
    void appendDroppedImages(editor, event.dataTransfer?.files);
  }, [editor]);

  return {
    handleContentDragOver,
    handleContentDrop,
  };
}
