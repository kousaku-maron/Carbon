import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkIndex, type LinkIndexIO } from "./link-index";

function fixture(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const revisions = new Map<string, number>();
  let cache: unknown;
  const io: LinkIndexIO = {
    files: vi.fn(async (root: string) => [...files.keys()].filter((path) =>
      (path === root || path.startsWith(root + '/')) && path.endsWith('.md'))),
    exists: vi.fn(async (path: string) => [...files.keys()].some((file) => file === path || file.startsWith(path + '/'))),
    stamp: vi.fn(async (path: string) => `${revisions.get(path) ?? 0}:${files.get(path)?.length}`),
    read: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`Missing: ${path}`);
      return files.get(path)!;
    }),
    write: vi.fn(async (path: string, body: string) => { files.set(path, body); revisions.set(path, (revisions.get(path) ?? 0) + 1); }),
    rename: vi.fn(async (from: string, to: string) => {
      for (const [path, body] of [...files]) if (path === from || path.startsWith(from + '/')) {
        files.delete(path); files.set(to + path.slice(from.length), body);
      }
    }),
    load: vi.fn(async () => cache),
    persist: vi.fn(async (value) => { cache = structuredClone(value); }),
  };
  const onError = vi.fn();
  const activity = vi.fn();
  const index = new LinkIndex('/vault', io, onError, activity);
  return { index, io, files, onError, activity };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('link index', () => {
  it('reads only affected notes during a move and updates both incoming and outgoing links', async () => {
    const { index, io, files } = fixture({
      '/vault/a.md': '[B](notes/b.md)', '/vault/notes/b.md': '[A](../a.md)', '/vault/unrelated.md': '# untouched',
    });
    await index.start(); vi.mocked(io.files).mockClear(); vi.mocked(io.read).mockClear();
    const moved = vi.fn();
    await index.move('/vault/notes', '/vault/archive/notes', moved);
    expect(files.get('/vault/a.md')).toBe('[B](./archive/notes/b.md)');
    expect(files.get('/vault/archive/notes/b.md')).toBe('[A](../../a.md)');
    expect(io.files).not.toHaveBeenCalled();
    expect(io.read).not.toHaveBeenCalledWith('/vault/unrelated.md');
    expect(moved).toHaveBeenCalledOnce();
    await index.move('/vault/archive/notes', '/vault/new', vi.fn());
    expect(files.get('/vault/a.md')).toBe('[B](./new/b.md)');
  });
  it('reuses persisted entries on restart and only parses changed files', async () => {
    const { index, io } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': '' });
    await index.start(); await vi.advanceTimersByTimeAsync(501);
    vi.mocked(io.read).mockClear();
    await io.write('/vault/b.md', 'changed');
    const restarted = new LinkIndex('/vault', io, vi.fn());
    await restarted.start();
    expect(io.read).toHaveBeenCalledTimes(1);
    expect(io.read).toHaveBeenCalledWith('/vault/b.md');
  });
  it('replaces reverse references after an edit, and removes deleted sources', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': '', '/vault/c.md': '' });
    await index.start();
    await io.write('/vault/a.md', '[C](c.md)'); await index.refresh(['/vault/a.md']);
    await index.move('/vault/b.md', '/vault/b2.md', vi.fn());
    expect(files.get('/vault/a.md')).toBe('[C](c.md)');
    files.delete('/vault/a.md'); await index.remove(['/vault/a.md']);
    await expect(index.move('/vault/c.md', '/vault/c2.md', vi.fn())).resolves.toEqual([]);
  });
  it('indexes new files before a queued move', async () => {
    const { index, io, files } = fixture({ '/vault/b.md': '' });
    await index.start(); await io.write('/vault/a.md', '[B](b.md)');
    const refreshing = index.refresh(['/vault/a.md']);
    const moving = index.move('/vault/b.md', '/vault/c.md', vi.fn());
    await Promise.all([refreshing, moving]);
    expect(files.get('/vault/a.md')).toBe('[B](./c.md)');
  });
  it('waits for initialization and refuses a move after an incomplete scan', async () => {
    const { index, io } = fixture({ '/vault/a.md': '' });
    vi.mocked(io.files).mockRejectedValue(new Error('Permission denied'));
    await expect(index.move('/vault/a.md', '/vault/b.md', vi.fn())).rejects.toThrow('Permission denied');
    expect(io.rename).not.toHaveBeenCalled();
  });
  it('rebuilds a corrupt cache', async () => {
    const { index, io } = fixture({ '/vault/a.md': '' });
    vi.mocked(io.load).mockRejectedValue(new Error('Invalid JSON'));
    await index.start(); expect(io.read).toHaveBeenCalledWith('/vault/a.md');
  });
  it('never overwrites a destination', async () => {
    const { index, io } = fixture({ '/vault/a.md': '', '/vault/b.md': '' });
    await expect(index.move('/vault/a.md', '/vault/b.md', vi.fn())).rejects.toThrow('already exists');
    expect(io.rename).not.toHaveBeenCalled();
  });
  it('rolls back repaired files and the move when a write fails', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': '[A](a.md)', '/vault/c.md': '[B](b.md)' });
    const original = new Map(files);
    const write = io.write;
    io.write = vi.fn(async (path, body) => {
      if (path === '/vault/c.md' && body.includes('new')) throw new Error('Disk full');
      await write(path, body);
    });
    const moved = vi.fn();
    await expect(index.move('/vault/b.md', '/vault/new/b.md', moved)).rejects.toThrow('Move cancelled');
    expect(files).toEqual(original); expect(moved).not.toHaveBeenCalled();
  });
  it('preserves a concurrent external edit and cancels the move', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': '' });
    const rename = io.rename;
    io.rename = async (from, to) => {
      await rename(from, to);
      if (from === '/vault/b.md') files.set('/vault/a.md', 'external edit');
    };
    await expect(index.move('/vault/b.md', '/vault/c.md', vi.fn())).rejects.toThrow('Move cancelled');
    expect(files.get('/vault/a.md')).toBe('external edit'); expect(files.has('/vault/b.md')).toBe(true);
  });
});

const longNote = Array.from({ length: 24 }, (_, i) => `Original section ${i}: document-specific text with details.\n`).join('');

describe('external rename reconciliation', () => {
  it('repairs incoming and outgoing links after moving and editing a document', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](notes/b.md#section)',
      '/vault/notes/b.md': longNote + '[A](../a.md)', '/vault/untouched.md': 'unrelated' });
    await index.start();
    await io.rename('/vault/notes/b.md', '/vault/archive/nested/b.md');
    await io.write('/vault/archive/nested/b.md', longNote.replace('section 2:', 'CHANGED 2:') + '[A](../a.md)');
    await index.remove(['/vault/notes/b.md']);
    await index.refresh(['/vault/archive/nested/b.md']);
    vi.mocked(io.read).mockClear(); vi.mocked(io.files).mockClear();
    await index.reconcile();
    expect(files.get('/vault/a.md')).toBe('[B](./archive/nested/b.md#section)');
    expect(files.get('/vault/archive/nested/b.md')).toContain('[A](../../a.md)');
    expect(files.get('/vault/archive/nested/b.md')).toContain('CHANGED 2:');
    expect(io.files).not.toHaveBeenCalled();
    expect(io.read).not.toHaveBeenCalledWith('/vault/untouched.md');
  });
  it('detects offline moves using persisted fingerprints', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote });
    await index.start(); await vi.advanceTimersByTimeAsync(501);
    await io.rename('/vault/b.md', '/vault/new.md');
    await io.write('/vault/new.md', longNote + 'new sentence');
    const reopened = new LinkIndex('/vault', io, vi.fn());
    await reopened.start(); await reopened.reconcile();
    expect(files.get('/vault/a.md')).toBe('[B](./new.md)');
  });
  it('defers ambiguous identical candidates instead of choosing one', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote });
    await index.start(); files.delete('/vault/b.md');
    await io.write('/vault/c.md', longNote); await io.write('/vault/d.md', longNote);
    await index.reconcile(true);
    expect(files.get('/vault/a.md')).toBe('[B](b.md)');
  });
  it('does not match two old files to the same new file', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md) [C](c.md)', '/vault/b.md': longNote, '/vault/c.md': longNote });
    await index.start(); files.delete('/vault/b.md'); files.delete('/vault/c.md');
    await io.write('/vault/d.md', longNote); await index.reconcile(true);
    expect(files.get('/vault/a.md')).toBe('[B](b.md) [C](c.md)');
  });
  it('preserves links already repaired by the AI', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote + '[A](a.md)' });
    await index.start(); await io.rename('/vault/b.md', '/vault/folder/b.md');
    await io.write('/vault/a.md', '[B](folder/b.md)');
    await io.write('/vault/folder/b.md', longNote + '[A](../a.md)');
    await index.reconcile(true);
    expect(files.get('/vault/a.md')).toBe('[B](folder/b.md)');
    expect(files.get('/vault/folder/b.md')).toBe(longNote + '[A](../a.md)');
  });
  it('keeps candidates pending while the editor has unsaved changes', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote });
    await index.start(); await io.rename('/vault/b.md', '/vault/c.md');
    await index.reconcile(true, async () => false);
    expect(files.get('/vault/a.md')).toBe('[B](b.md)');
    await index.reconcile(); expect(files.get('/vault/a.md')).toBe('[B](./c.md)');
  });
  it('rejects a candidate changed again while planning repair', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote });
    await index.start(); await io.rename('/vault/b.md', '/vault/c.md');
    await expect(index.reconcile(true, async (write) => {
      await io.write('/vault/c.md', 'replaced'); await write(); return true;
    })).rejects.toThrow('Files changed during link repair');
    expect(files.get('/vault/a.md')).toBe('[B](b.md)');
  });
  it('does not overwrite a concurrent edit to a referring note', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote });
    await index.start(); await io.rename('/vault/b.md', '/vault/c.md');
    await expect(index.reconcile(true, async (write) => {
      await io.write('/vault/a.md', 'external edit'); await write(); return true;
    })).rejects.toThrow('File changed during link repair');
    expect(files.get('/vault/a.md')).toBe('external edit');
  });
  it('does not identify a copy as a move while the source still exists', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote });
    await index.start(); await io.write('/vault/c.md', longNote); await index.reconcile(true);
    expect(files.get('/vault/a.md')).toBe('[B](b.md)');
  });
  it('ignores empty files and short inexact matches', async () => {
    const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': 'hello\nworld\n' });
    await index.start(); await io.rename('/vault/b.md', '/vault/c.md'); await io.write('/vault/c.md', 'hello\nworld!\n');
    await index.reconcile(true); expect(files.get('/vault/a.md')).toBe('[B](b.md)');
  });
});

it('requires a margin even when the runner-up is below the acceptance threshold', async () => {
  const line = (i: number) => `Unique line number ${String(i).padStart(3, '0')} abcdefghijklmnopqrstuvwxyz\n`;
  const original = Array.from({ length: 100 }, (_, i) => line(i)).join('');
  const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': original });
  await index.start(); files.delete('/vault/b.md');
  await io.write('/vault/c.md', Array.from({ length: 100 }, (_, i) => line(i < 90 ? i : i + 100)).join(''));
  await io.write('/vault/d.md', Array.from({ length: 100 }, (_, i) => line(i < 84 ? i : i + 200)).join(''));
  await index.reconcile(true);
  expect(files.get('/vault/a.md')).toBe('[B](b.md)');
});

it('retries safely after a background write fails', async () => {
  const { index, io, files } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote });
  await index.start(); await io.rename('/vault/b.md', '/vault/c.md');
  vi.mocked(io.write).mockRejectedValueOnce(new Error('Permission denied'));
  await expect(index.reconcile(true)).rejects.toThrow('Permission denied');
  expect(files.get('/vault/a.md')).toBe('[B](b.md)');
  await index.reconcile(); expect(files.get('/vault/a.md')).toBe('[B](./c.md)');
});

it('uses the original directory when simultaneous moves make an href resemble another old target', async () => {
  const { index, io, files } = fixture({
    '/vault/a/b/note.md': longNote + '[C](../c.md)',
    '/vault/a/c.md': 'original target',
    '/vault/x/c.md': 'different target',
  });
  await index.start();
  await io.rename('/vault/a/b/note.md', '/vault/x/b/note.md');
  await io.rename('/vault/x/c.md', '/vault/z/c.md');
  await index.reconcile(true);
  expect(files.get('/vault/x/b/note.md')).toContain('[C](../../a/c.md)');
  expect(files.get('/vault/x/b/note.md')).not.toContain('z/c.md');
});

it('reports indexing immediately and clears activity when indexing fails', async () => {
  const { index, io, activity } = fixture({ '/vault/a.md': '' });
  let finish!: () => void;
  vi.mocked(io.files).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(['/vault/a.md']); }));
  const starting = index.start();
  await Promise.resolve();
  expect(activity).toHaveBeenLastCalledWith('updating');
  await Promise.resolve();
  finish();
  await starting;
  expect(activity).toHaveBeenLastCalledWith(null);
  vi.mocked(io.read).mockRejectedValueOnce(new Error('Read failed'));
  await expect(index.refresh(['/vault/a.md'])).rejects.toThrow('Read failed');
  expect(activity.mock.calls.slice(-2)).toEqual([['updating'], [null]]);
});

it('reports actual background repair and clears activity after a failed write', async () => {
  const { index, io, activity } = fixture({ '/vault/a.md': '[B](b.md)', '/vault/b.md': longNote });
  await index.start(); await io.rename('/vault/b.md', '/vault/c.md');
  activity.mockClear();
  vi.mocked(io.write).mockImplementationOnce(async () => {
    expect(activity).toHaveBeenLastCalledWith('repairing');
    throw new Error('Write failed');
  });
  await expect(index.reconcile(true)).rejects.toThrow('Write failed');
  expect(activity.mock.calls).toEqual([['updating'], ['repairing'], [null]]);
});
