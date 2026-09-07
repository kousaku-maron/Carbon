import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ files: new Map<string, string>(), watcher: {} as Record<string, any> }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (path: string) => {
    if (!state.files.has(path)) throw new Error('Missing: ' + path);
    return state.files.get(path)!;
  }),
  writeTextFile: vi.fn(async (path: string, body: string) => { state.files.set(path, body); }),
  readDir: vi.fn(async () => []), mkdir: vi.fn(), remove: vi.fn(), rename: vi.fn(), stat: vi.fn(), exists: vi.fn(),
}));
vi.mock('../../modules/store', () => ({
  getVaultPath: async () => '/vault', getVaultHistory: async () => [], setVaultPath: vi.fn(), removeFromHistory: vi.fn(),
}));
vi.mock('../use-file-watcher', () => ({ useFileWatcher: (options: Record<string, any>) => { state.watcher = options; } }));
vi.mock('../../modules/link-index', async (original) => {
  const actual = await original<typeof import('../../modules/link-index')>();
  return {
    ...actual,
    createLinkIndex: (vault: string, onError: (message: string) => void) => new actual.LinkIndex(vault, {
      files: async (root) => [...state.files.keys()].filter((path) => path === root || path.startsWith(root + '/')),
      exists: async (path) => state.files.has(path),
      stamp: async (path) => state.files.get(path) ?? '',
      read: async (path) => state.files.get(path)!,
      write: async (path, body) => { state.files.set(path, body); },
      rename: async (from, to) => {
        for (const [path, body] of [...state.files]) if (path === from || path.startsWith(from + '/')) {
          state.files.delete(path); state.files.set(to + path.slice(from.length), body);
        }
      },
      load: async () => null, persist: async () => {},
    }, onError),
  };
});
import { useVault } from '../use-vault';

async function mount() {
  let value!: ReturnType<typeof useVault>;
  const onError = vi.fn();
  function Harness() { value = useVault({ onError }); return null; }
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Harness />); });
  return { get: () => value, renderer, onError };
}
const node = { id: 'a.md', name: 'a', path: '/vault/a.md', kind: 'file' as const };
beforeEach(() => { vi.useFakeTimers(); state.files = new Map([['/vault/a.md', '[B](b.md)'], ['/vault/b.md', 'B']]); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('vault link repair and editor saves', () => {
  it('flushes unsaved links and rejects stale debounce callbacks after renaming a target', async () => {
    const { get, renderer, onError } = await mount();
    await act(async () => { await get().handleSelectNote(node); });
    const oldSave = get().handleSaveNote;
    act(() => { get().handleEditorBufferChange(node.path, 'draft [B](b.md)'); });
    await act(async () => { await get().handleRename('/vault/b.md', 'c'); });
    expect(state.files.get('/vault/a.md')).toBe('draft [B](./c.md)');
    expect(get().getActiveNoteSnapshot()?.body).toBe('draft [B](./c.md)');
    await act(async () => { await oldSave('/vault/a.md', 'draft [B](b.md)'); });
    expect(state.files.get('/vault/a.md')).toBe('draft [B](./c.md)');
    expect(onError).not.toHaveBeenCalled();
    renderer.unmount();
  });
  it('rebases the active note, updates outgoing links and permits subsequent saves', async () => {
    const { get, renderer } = await mount();
    await act(async () => { await get().handleSelectNote(node); });
    await act(async () => { await get().handleMove('/vault/a.md', '/vault/folder'); });
    expect(get().getActiveNoteSnapshot()?.path).toBe('/vault/folder/a.md');
    expect(get().getActiveNoteSnapshot()?.body).toBe('[B](../b.md)');
    await act(async () => { await get().handleSaveNote('/vault/folder/a.md', 'edited'); });
    expect(state.files.get('/vault/folder/a.md')).toBe('edited');
    expect(state.files.has('/vault/a.md')).toBe(false);
    renderer.unmount();
  });
  it('cancels a move instead of overwriting external changes with a dirty buffer', async () => {
    const { get, renderer, onError } = await mount();
    await act(async () => { await get().handleSelectNote(node); });
    act(() => { get().handleEditorBufferChange(node.path, 'my draft'); });
    state.files.set('/vault/a.md', 'external edit');
    await act(async () => { await get().handleRename('/vault/b.md', 'c'); });
    expect(state.files.get('/vault/a.md')).toBe('external edit');
    expect(state.files.has('/vault/b.md')).toBe(true);
    expect(get().getActiveNoteSnapshot()?.body).toBe('my draft');
    expect(onError).toHaveBeenCalled();
    expect(get().movingFiles).toBe(false);
    renderer.unmount();
  });
});

it('repairs external delete/add events in the background and reloads the editor', async () => {
  const { get, renderer } = await mount();
  await act(async () => { await get().handleSelectNote(node); });
  state.files.delete('/vault/b.md'); state.files.set('/vault/c.md', 'B');
  await act(async () => {
    state.watcher.onPathsRemoved(['/vault/b.md']);
    state.watcher.onPathsAvailable(['/vault/c.md']);
    await state.watcher.onFileChange(['/vault/c.md']);
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(state.files.get('/vault/a.md')).toBe('[B](./c.md)');
  expect(get().getActiveNoteSnapshot()?.body).toBe('[B](./c.md)');
  renderer.unmount();
});
