import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CopyMarkdownButton } from './CopyMarkdownButton';
import { FormField } from './FormField';
import { MarkdownEditor } from './MarkdownEditor';

type Props = {
  mode: 'create' | 'edit';
  noteId?: string;
  initialFolderId?: string;
  initialTitle?: string;
  initialContent?: string;
  createdAtLabel?: string;
  updatedAtLabel?: string;
  seamless?: boolean;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function PostForm({
  mode,
  noteId,
  initialFolderId,
  initialTitle,
  initialContent,
  createdAtLabel,
  updatedAtLabel,
  seamless = false,
}: Props) {
  const [statusText, setStatusText] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [loading, setLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(mode === 'edit');
  const [authEmail, setAuthEmail] = useState('');
  const [title, setTitle] = useState(initialTitle ?? '');
  const [content, setContent] = useState(initialContent ?? '');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  // Sync state when props change (e.g. View Transitions re-hydration)
  useEffect(() => {
    setTitle(initialTitle ?? '');
  }, [initialTitle]);

  useEffect(() => {
    setContent(initialContent ?? '');
  }, [initialContent]);

  useEffect(() => {
    if (mode === 'create') {
      fetch('/api/me', { credentials: 'include', cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          const me = json?.data;
          if (!me?.authenticated) {
            window.location.href = '/login';
            return;
          }
          setAuthEmail(me.user?.email ?? 'user');
          setAuthChecked(true);
        });
    }
  }, [mode]);

  // Auto-save for seamless edit mode
  const autoSave = useCallback(async (t: string, c: string) => {
    if (mode !== 'edit' || !seamless || !noteId || isSavingRef.current) return;
    if (!t.trim() || !c.trim()) return;

    isSavingRef.current = true;
    setSaveStatus('saving');

    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, content: c }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveStatus('saved');
      setStatusText('');
      setTimeout(() => setSaveStatus((prev) => (prev === 'saved' ? 'idle' : prev)), 2000);
    } catch (err) {
      setSaveStatus('error');
      setStatusText(err instanceof Error ? err.message : 'Save failed');
    } finally {
      isSavingRef.current = false;
    }
  }, [mode, seamless, noteId]);

  const scheduleAutoSave = useCallback((t: string, c: string) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => autoSave(t, c), 1500);
  }, [autoSave]);

  // Trigger auto-save on content change in seamless mode
  useEffect(() => {
    if (mode !== 'edit' || !seamless) return;
    // Don't auto-save if nothing changed from initial
    if (title === (initialTitle ?? '') && content === (initialContent ?? '')) return;
    scheduleAutoSave(title, content);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [title, content, mode, seamless, scheduleAutoSave, initialTitle, initialContent]);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setLoading(true);

    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const payload = {
      title: seamless ? title : String(data.get('title') || ''),
      content: seamless ? content : String(data.get('content') || ''),
      folder_id: mode === 'create' ? (String(data.get('folder_id') || '') || null) : undefined,
    };

    if (!payload.title.trim() || !payload.content.trim()) {
      setStatusText('Title and content are required.');
      setSaveStatus('error');
      setLoading(false);
      return;
    }

    const url = mode === 'create' ? '/api/notes' : `/api/notes/${noteId}`;
    const method = mode === 'create' ? 'POST' : 'PATCH';

    try {
      setSaveStatus('saving');
      setStatusText(mode === 'create' ? 'Saving note...' : 'Updating note...');
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());

      const json = await res.json();
      const createdId = json?.data?.id;

      if (mode === 'create') {
        setStatusText('Saved. Redirecting...');
        setSaveStatus('saved');
        if (createdId) {
          setTimeout(() => {
            window.location.href = `/notes/${createdId}`;
          }, 400);
        } else {
          setStatusText('Saved, but failed to get note ID.');
          setLoading(false);
        }
        return;
      }

      if (seamless) {
        setSaveStatus('saved');
        setStatusText('');
        setLoading(false);
        setTimeout(() => setSaveStatus((prev) => (prev === 'saved' ? 'idle' : prev)), 2000);
        return;
      }

      setStatusText('Updated. Redirecting...');
      setSaveStatus('saved');
      setTimeout(() => {
        window.location.href = `/notes/${noteId}`;
      }, 400);
      return;
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : 'Failed');
      setSaveStatus('error');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    setLoading(true);
    setStatusText('Deleting...');
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      window.location.href = '/';
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : 'Delete failed');
      setSaveStatus('error');
      setLoading(false);
    }
  };

  const statusIndicator = () => {
    if (saveStatus === 'saving') return <span className="status-message">Saving...</span>;
    if (saveStatus === 'saved') return <span className="status-message status-success">Saved</span>;
    if (saveStatus === 'error') return <span className="status-message status-error">{statusText || 'Error'}</span>;
    if (statusText) return <span className="status-message">{statusText}</span>;
    return null;
  };

  if (!authChecked) {
    return <p className="muted text-sm">Checking session...</p>;
  }

  if (seamless && mode === 'edit') {
    return (
      <>
        <form onSubmit={handleSubmit} className="seamless-editor">
          <div className="seamless-title-row">
            <input
              className="seamless-title-input"
              name="title"
              value={title}
              required
              maxLength={200}
              placeholder="Untitled"
              onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
            />
            <div className="seamless-title-actions">
              {statusIndicator()}
              <CopyMarkdownButton markdown={content} />
              <button
                type="button"
                className="seamless-icon-btn seamless-icon-btn-danger"
                onClick={handleDelete}
                disabled={loading}
                aria-label="Delete note"
                title="Delete note"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 4h11M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4M6.5 7v4M9.5 7v4M3.5 4l.5 8.5a1.5 1.5 0 001.5 1.5h5a1.5 1.5 0 001.5-1.5L12.5 4" />
                </svg>
              </button>
            </div>
          </div>

          {(createdAtLabel || updatedAtLabel) && (
            <div className="seamless-note-meta" aria-label="Note dates">
              {createdAtLabel ? <span>Created on: {createdAtLabel}</span> : null}
              {updatedAtLabel ? <span>Updated on: {updatedAtLabel}</span> : null}
            </div>
          )}

          <MarkdownEditor
            name="content"
            value={content}
            onChange={setContent}
            placeholder="Start writing..."
            className="seamless-content-shell"
            editorClassName="seamless-content-input"
            ariaLabel="Note content"
          />
        </form>
      </>
    );
  }

  return (
    <>
      {authEmail && <p className="muted text-sm">Signed in as {authEmail}</p>}

      <form onSubmit={handleSubmit} className="stack" style={{ marginTop: 16 }}>
        {mode === 'create' && initialFolderId ? <input type="hidden" name="folder_id" value={initialFolderId} /> : null}
        <FormField
          label="Title"
          name="title"
          required
          maxLength={200}
          placeholder="Note title"
          value={initialTitle}
        />
        <div className="form-group">
          <label className="form-label" htmlFor="field-content">
            Markdown
          </label>
          <MarkdownEditor
            id="field-content"
            name="content"
            value={content}
            onChange={setContent}
            placeholder="Write markdown..."
            ariaLabel="Markdown content"
          />
        </div>

        <div className="btn-row">
          <button type="submit" disabled={loading}>
            {mode === 'create' ? 'Create note' : 'Update note'}
          </button>
          {mode === 'edit' && (
            <button type="button" className="btn-danger" onClick={handleDelete} disabled={loading}>
              Delete
            </button>
          )}
        </div>
      </form>

      {statusIndicator()}
    </>
  );
}
