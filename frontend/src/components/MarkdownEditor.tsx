import { Editor } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'preact/hooks';

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  className?: string;
  editorClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
};

function joinClassNames(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  name,
  className,
  editorClassName,
  placeholder = 'Write markdown...',
  ariaLabel = 'Markdown editor',
}: Props) {
  const editorRootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const element = editorRootRef.current;
    if (!element) return;

    const editor = new Editor({
      element,
      content: valueRef.current,
      contentType: 'markdown',
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder }),
        Markdown,
      ],
      editorProps: {
        attributes: {
          ...(id ? { id } : {}),
          class: joinClassNames('tiptap-input', editorClassName),
          'aria-label': ariaLabel,
        },
      },
      onUpdate: ({ editor: instance }) => {
        const markdown = instance.getMarkdown();
        if (markdown === valueRef.current) return;
        valueRef.current = markdown;
        onChangeRef.current(markdown);
      },
    });

    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [ariaLabel, editorClassName, id, placeholder]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (editor.getMarkdown() === value) return;
    valueRef.current = value;
    editor.commands.setContent(value, { contentType: 'markdown' });
  }, [value]);

  return (
    <div className={joinClassNames('tiptap-shell', className)}>
      <div ref={editorRootRef} />
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}
