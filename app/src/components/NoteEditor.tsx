import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import type { NoteContent } from "../lib/types";

type SaveStatus = "saved" | "saving" | "unsaved" | "error";

export function NoteEditor(props: {
  note: NoteContent;
  onSave: (path: string, content: string) => Promise<void>;
}) {
  const { note, onSave } = props;
  const noteIdRef = useRef(note.id);
  const notePathRef = useRef(note.path);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const doSave = useCallback(
    async (path: string, md: string) => {
      setSaveStatus("saving");
      try {
        await onSave(path, md);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
        throw new Error("Failed to save");
      }
    },
    [onSave],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: { languageClassPrefix: "language-" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
    ],
    content: markdownToHtml(note.body),
    onUpdate: ({ editor: ed }) => {
      setSaveStatus("unsaved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const html = ed.getHTML();
        const md = htmlToMarkdown(html);
        void doSave(notePathRef.current, md);
      }, 500);
    },
  });

  // When a different note is selected, flush pending save and load new content
  useEffect(() => {
    if (!editor) return;
    if (note.id === noteIdRef.current) return;

    // Flush pending save for previous note
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      void onSave(notePathRef.current, md);
    }

    noteIdRef.current = note.id;
    notePathRef.current = note.path;
    setSaveStatus("saved");

    const html = markdownToHtml(note.body);
    editor.commands.setContent(html, false);
  }, [editor, note.id, note.path, note.body, onSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="note-editor">
      <header className="note-editor-header">
        <h1 className="note-editor-title">{note.name}</h1>
        <span className="note-editor-status">
          {saveStatus === "saving"
            ? "Saving..."
            : saveStatus === "unsaved"
              ? "Unsaved"
              : saveStatus === "error"
                ? "Save failed"
              : ""}
        </span>
      </header>
      <div className="note-editor-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
