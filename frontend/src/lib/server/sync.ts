import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import { notes, syncConnections, noteSyncState, syncEvents } from '../../../db/schema/app';
import type { Database } from './db';
import {
  getGitHubAccessToken,
  collectMarkdownFiles,
  getFileContent,
  decodeBase64Content,
  getLatestCommitSha,
  putFileContent,
  deleteRepoFile,
  type GitHubContentItem,
} from './github';

// ── Frontmatter parsing ──────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

type ParsedMarkdown = {
  title: string;
  content: string;
  carbonNoteId: string | null;
};

export function parseMarkdown(raw: string, fileName: string): ParsedMarkdown {
  let body = raw;
  let carbonNoteId: string | null = null;

  const fmMatch = body.match(FRONTMATTER_RE);
  if (fmMatch) {
    const fmBlock = fmMatch[1];
    body = body.slice(fmMatch[0].length);

    for (const line of fmBlock.split(/\r?\n/)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'carbon_note_id') {
        carbonNoteId = value || null;
      }
    }
  }

  let title = fileName.replace(/\.md$/, '');
  const h1Match = body.match(/^#\s+(.+)$/m);
  if (h1Match) {
    title = h1Match[1].trim();
  }

  return { title, content: body.trim(), carbonNoteId };
}

// ── Content hashing ──────────────────────────────────────────

export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Frontmatter generation (for push) ────────────────────────

export function buildMarkdownForPush(noteId: string, title: string, content: string): string {
  const frontmatter = `---\ncarbon_note_id: "${noteId}"\n---\n\n`;
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match && h1Match[1].trim() === title.trim()) {
    return frontmatter + content;
  }
  return frontmatter + `# ${title}\n\n` + content;
}

export function noteToFilePath(basePath: string, title: string): string {
  const sanitized = title
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  const fileName = (sanitized || 'untitled') + '.md';
  return basePath ? `${basePath}/${fileName}` : fileName;
}

// ── Conflict resolution strategy ─────────────────────────────

export type SyncItemState =
  | 'unchanged'
  | 'local_modified'
  | 'remote_modified'
  | 'both_modified'
  | 'local_created'
  | 'remote_created'
  | 'local_deleted'
  | 'remote_deleted';

export type SyncItem = {
  state: SyncItemState;
  noteId: string | null;
  filePath: string | null;
  syncStateId: string | null;
  localTitle: string | null;
  localContent: string | null;
  localUpdatedAt: Date | null;
  remoteContent: string | null;
  remoteTitle: string | null;
  remoteFileSha: string | null;
  remoteContentHash: string | null;
  lastContentHash: string | null;
  lastFileSha: string | null;
};

export type ConflictResolution = 'use_local' | 'use_remote' | 'skip';

export interface ConflictResolutionStrategy {
  resolve(item: SyncItem): ConflictResolution;
}

export class LocalWinsStrategy implements ConflictResolutionStrategy {
  resolve(_item: SyncItem): ConflictResolution {
    return 'use_local';
  }
}

export class RemoteWinsStrategy implements ConflictResolutionStrategy {
  resolve(_item: SyncItem): ConflictResolution {
    return 'use_remote';
  }
}

// ── Bidirectional sync engine ────────────────────────────────

export type FullSyncResult = {
  pulled: { created: number; updated: number; deleted: number };
  pushed: { created: number; updated: number; deleted: number };
  conflicts: { resolved: number; skipped: number };
  errors: number;
  details: Array<{
    path: string | null;
    noteId: string | null;
    action: string;
    direction: 'pull' | 'push' | 'conflict';
    error?: string;
  }>;
};

export async function executeSync(
  db: Database,
  connectionId: string,
  userId: string,
  strategy: ConflictResolutionStrategy = new LocalWinsStrategy()
): Promise<FullSyncResult> {
  const result: FullSyncResult = {
    pulled: { created: 0, updated: 0, deleted: 0 },
    pushed: { created: 0, updated: 0, deleted: 0 },
    conflicts: { resolved: 0, skipped: 0 },
    errors: 0,
    details: [],
  };

  // ── Phase 1: Gather data ───────────────────────────────────

  const connRows = await db
    .select()
    .from(syncConnections)
    .where(and(eq(syncConnections.id, connectionId), eq(syncConnections.userId, userId)))
    .limit(1);

  const conn = connRows[0];
  if (!conn) throw new Error('Connection not found');
  if (conn.status !== 'active') throw new Error('Connection is paused');

  const token = await getGitHubAccessToken(db, userId);
  if (!token) throw new Error('GitHub access token not found. Please re-login with GitHub.');

  const commitSha = await getLatestCommitSha(token, conn.repoOwner, conn.repoName, conn.branch);
  const remoteFiles = await collectMarkdownFiles(token, conn.repoOwner, conn.repoName, conn.basePath, conn.branch);

  const syncStates = await db
    .select()
    .from(noteSyncState)
    .where(eq(noteSyncState.connectionId, connectionId));

  const userNotes = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, userId));

  // ── Phase 2: Build lookup maps ─────────────────────────────

  const stateByPath = new Map(syncStates.map((s) => [s.filePath, s]));
  const stateByNoteId = new Map<string, typeof syncStates[number]>();
  for (const s of syncStates) {
    if (s.noteId) stateByNoteId.set(s.noteId, s);
  }
  const noteById = new Map(userNotes.map((n) => [n.id, n]));
  const remoteByPath = new Map(remoteFiles.map((f) => [f.path, f]));

  // ── Phase 3: Classify each item ────────────────────────────

  const items: SyncItem[] = [];
  const classifiedNoteIds = new Set<string>();
  const classifiedPaths = new Set<string>();

  // 3a. Existing sync states
  for (const state of syncStates) {
    classifiedPaths.add(state.filePath);
    if (state.noteId) classifiedNoteIds.add(state.noteId);

    // Locally deleted
    if (state.deletedAt || !state.noteId) {
      items.push({
        state: 'local_deleted',
        noteId: state.noteId,
        filePath: state.filePath,
        syncStateId: state.id,
        localTitle: null,
        localContent: null,
        localUpdatedAt: null,
        remoteContent: null,
        remoteTitle: null,
        remoteFileSha: remoteByPath.get(state.filePath)?.sha ?? null,
        remoteContentHash: null,
        lastContentHash: state.lastContentHash,
        lastFileSha: state.lastFileSha,
      });
      continue;
    }

    const note = noteById.get(state.noteId);
    const remoteFile = remoteByPath.get(state.filePath);

    if (!note) {
      // Note gone but no deletedAt (shouldn't happen normally, but handle it)
      items.push({
        state: 'local_deleted',
        noteId: null,
        filePath: state.filePath,
        syncStateId: state.id,
        localTitle: null,
        localContent: null,
        localUpdatedAt: null,
        remoteContent: null,
        remoteTitle: null,
        remoteFileSha: remoteFile?.sha ?? null,
        remoteContentHash: null,
        lastContentHash: state.lastContentHash,
        lastFileSha: state.lastFileSha,
      });
      continue;
    }

    if (!remoteFile) {
      // File removed from GitHub
      items.push({
        state: 'remote_deleted',
        noteId: state.noteId,
        filePath: state.filePath,
        syncStateId: state.id,
        localTitle: note.title,
        localContent: note.content,
        localUpdatedAt: note.updatedAt,
        remoteContent: null,
        remoteTitle: null,
        remoteFileSha: null,
        remoteContentHash: null,
        lastContentHash: state.lastContentHash,
        lastFileSha: state.lastFileSha,
      });
      continue;
    }

    // Both exist — check for changes
    // Local change: notes.updatedAt > lastSyncedNoteUpdatedAt
    // If lastSyncedNoteUpdatedAt is NULL (pre-migration), treat as unchanged
    const localChanged = state.lastSyncedNoteUpdatedAt != null
      && note.updatedAt.getTime() > state.lastSyncedNoteUpdatedAt.getTime();

    // Remote change will be determined after fetching content (deferred)
    items.push({
      state: 'unchanged', // placeholder, will be updated after content fetch
      noteId: state.noteId,
      filePath: state.filePath,
      syncStateId: state.id,
      localTitle: note.title,
      localContent: note.content,
      localUpdatedAt: note.updatedAt,
      remoteContent: null, // to be fetched
      remoteTitle: null,
      remoteFileSha: remoteFile.sha,
      remoteContentHash: null, // to be computed
      lastContentHash: state.lastContentHash,
      lastFileSha: state.lastFileSha,
      // Store localChanged temporarily via state
    });
    // Mark the actual state after content fetch below
    (items[items.length - 1] as SyncItem & { _localChanged: boolean })._localChanged = localChanged;
  }

  // 3b. Remote files with no sync state (new remote files)
  for (const remoteFile of remoteFiles) {
    if (classifiedPaths.has(remoteFile.path)) continue;
    classifiedPaths.add(remoteFile.path);

    items.push({
      state: 'remote_created',
      noteId: null,
      filePath: remoteFile.path,
      syncStateId: null,
      localTitle: null,
      localContent: null,
      localUpdatedAt: null,
      remoteContent: null,
      remoteTitle: null,
      remoteFileSha: remoteFile.sha,
      remoteContentHash: null,
      lastContentHash: null,
      lastFileSha: null,
    });
  }

  // 3c. Notes with no sync state (new local notes, candidates for push)
  for (const note of userNotes) {
    if (classifiedNoteIds.has(note.id)) continue;
    items.push({
      state: 'local_created',
      noteId: note.id,
      filePath: null,
      syncStateId: null,
      localTitle: note.title,
      localContent: note.content,
      localUpdatedAt: note.updatedAt,
      remoteContent: null,
      remoteTitle: null,
      remoteFileSha: null,
      remoteContentHash: null,
      lastContentHash: null,
      lastFileSha: null,
    });
  }

  // ── Phase 3.5: Fetch remote content for items that need comparison ──

  for (const item of items) {
    if (item.state !== 'unchanged' && item.state !== 'remote_created') continue;
    if (!item.filePath) continue;

    try {
      const fileData = await getFileContent(token, conn.repoOwner, conn.repoName, item.filePath, conn.branch);
      if (!fileData) continue;

      const rawContent = decodeBase64Content(fileData.content);
      const fileName = item.filePath.split('/').pop() ?? 'untitled.md';
      const parsed = parseMarkdown(rawContent, fileName);
      item.remoteContent = rawContent;
      item.remoteTitle = parsed.title;
      item.remoteContentHash = await hashContent(rawContent);
      item.remoteFileSha = fileData.sha;

      // Finalize state for existing sync items
      if (item.state === 'unchanged') {
        const localChanged = (item as SyncItem & { _localChanged?: boolean })._localChanged ?? false;
        const remoteChanged = item.remoteContentHash !== item.lastContentHash;

        if (localChanged && remoteChanged) {
          item.state = 'both_modified';
        } else if (localChanged) {
          item.state = 'local_modified';
        } else if (remoteChanged) {
          item.state = 'remote_modified';
        }
        // else stays 'unchanged'
      }
    } catch {
      // Content fetch failed; skip this item
    }
  }

  // ── Phase 4: Execute actions ───────────────────────────────

  for (const item of items) {
    try {
      switch (item.state) {
        case 'unchanged':
          break;

        case 'remote_modified':
          await applyPull(db, conn, item, commitSha, userId, result);
          break;

        case 'local_modified':
          await applyPush(db, conn, token, item, commitSha, result);
          break;

        case 'both_modified': {
          const resolution = strategy.resolve(item);
          if (resolution === 'use_local') {
            await applyPush(db, conn, token, item, commitSha, result);
            result.conflicts.resolved++;
          } else if (resolution === 'use_remote') {
            await applyPull(db, conn, item, commitSha, userId, result);
            result.conflicts.resolved++;
          } else {
            result.conflicts.skipped++;
            result.details.push({
              path: item.filePath,
              noteId: item.noteId,
              action: 'conflict_skipped',
              direction: 'conflict',
            });
            await logSyncEvent(db, connectionId, 'pull', 'conflict', item.noteId, item.filePath, commitSha, 'conflict');
          }
          break;
        }

        case 'remote_created':
          await applyRemoteCreated(db, conn, token, item, commitSha, userId, result);
          break;

        case 'local_created':
          await applyLocalCreated(db, conn, token, item, commitSha, result);
          break;

        case 'local_deleted':
          await applyLocalDeleted(db, conn, token, item, commitSha, result);
          break;

        case 'remote_deleted':
          await applyRemoteDeleted(db, conn, item, commitSha, result);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors++;
      result.details.push({
        path: item.filePath,
        noteId: item.noteId,
        action: 'error',
        direction: item.state.startsWith('local') ? 'push' : 'pull',
        error: message,
      });
      await logSyncEvent(db, connectionId, item.state.startsWith('local') ? 'push' : 'pull', 'upsert', item.noteId, item.filePath, commitSha, 'error', message);
    }
  }

  // ── Phase 5: Update connection timestamp ───────────────────

  await db
    .update(syncConnections)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(syncConnections.id, connectionId));

  return result;
}

// ── Action helpers ───────────────────────────────────────────

type ConnRow = typeof syncConnections.$inferSelect;

async function applyPull(
  db: Database,
  conn: ConnRow,
  item: SyncItem,
  commitSha: string | null,
  userId: string,
  result: FullSyncResult
) {
  if (!item.noteId || !item.remoteTitle || !item.syncStateId) return;

  const parsed = parseMarkdown(item.remoteContent!, item.filePath?.split('/').pop() ?? 'untitled.md');
  const now = new Date();

  await db
    .update(notes)
    .set({ title: parsed.title, content: parsed.content, updatedAt: now })
    .where(eq(notes.id, item.noteId));

  await db
    .update(noteSyncState)
    .set({
      lastContentHash: item.remoteContentHash!,
      lastRepoCommitSha: commitSha,
      lastSyncedNoteUpdatedAt: now,
      lastFileSha: item.remoteFileSha,
      updatedAt: now,
    })
    .where(eq(noteSyncState.id, item.syncStateId));

  await logSyncEvent(db, conn.id, 'pull', 'upsert', item.noteId, item.filePath, commitSha, 'done');
  result.pulled.updated++;
  result.details.push({ path: item.filePath, noteId: item.noteId, action: 'updated', direction: 'pull' });
}

async function applyPush(
  db: Database,
  conn: ConnRow,
  token: string,
  item: SyncItem,
  commitSha: string | null,
  result: FullSyncResult
) {
  if (!item.noteId || !item.localTitle || item.localContent == null || !item.filePath || !item.syncStateId) return;

  const markdown = buildMarkdownForPush(item.noteId, item.localTitle, item.localContent);
  const contentHash = await hashContent(markdown);

  const pushResult = await putFileContent(
    token,
    conn.repoOwner,
    conn.repoName,
    item.filePath,
    markdown,
    `sync: update ${item.filePath}`,
    conn.branch,
    item.lastFileSha
  );

  const now = new Date();
  await db
    .update(noteSyncState)
    .set({
      lastContentHash: contentHash,
      lastRepoCommitSha: pushResult.commitSha,
      lastSyncedNoteUpdatedAt: item.localUpdatedAt,
      lastFileSha: pushResult.fileSha,
      updatedAt: now,
    })
    .where(eq(noteSyncState.id, item.syncStateId));

  await logSyncEvent(db, conn.id, 'push', 'upsert', item.noteId, item.filePath, pushResult.commitSha, 'done');
  result.pushed.updated++;
  result.details.push({ path: item.filePath, noteId: item.noteId, action: 'updated', direction: 'push' });
}

async function applyRemoteCreated(
  db: Database,
  conn: ConnRow,
  token: string,
  item: SyncItem,
  commitSha: string | null,
  userId: string,
  result: FullSyncResult
) {
  if (!item.filePath || !item.remoteContent) return;

  const fileName = item.filePath.split('/').pop() ?? 'untitled.md';
  const parsed = parseMarkdown(item.remoteContent, fileName);
  const contentHash = await hashContent(item.remoteContent);

  // Check frontmatter for existing note link
  let noteId: string | null = null;
  if (parsed.carbonNoteId) {
    const existing = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.id, parsed.carbonNoteId), eq(notes.userId, userId)))
      .limit(1);

    if (existing[0]) {
      noteId = existing[0].id;
      await db
        .update(notes)
        .set({ title: parsed.title, content: parsed.content, updatedAt: new Date() })
        .where(eq(notes.id, noteId));
      result.pulled.updated++;
      result.details.push({ path: item.filePath, noteId, action: 'updated', direction: 'pull' });
    }
  }

  if (!noteId) {
    const inserted = await db
      .insert(notes)
      .values({ userId, title: parsed.title, content: parsed.content })
      .returning({ id: notes.id });
    noteId = inserted[0].id;
    result.pulled.created++;
    result.details.push({ path: item.filePath, noteId, action: 'created', direction: 'pull' });
  }

  const now = new Date();
  await db.insert(noteSyncState).values({
    connectionId: conn.id,
    noteId,
    filePath: item.filePath,
    lastContentHash: contentHash,
    lastRepoCommitSha: commitSha,
    lastSyncedNoteUpdatedAt: now,
    lastFileSha: item.remoteFileSha,
  });

  await logSyncEvent(db, conn.id, 'pull', 'upsert', noteId, item.filePath, commitSha, 'done');
}

async function applyLocalCreated(
  db: Database,
  conn: ConnRow,
  token: string,
  item: SyncItem,
  commitSha: string | null,
  result: FullSyncResult
) {
  if (!item.noteId || !item.localTitle || item.localContent == null) return;

  const filePath = noteToFilePath(conn.basePath, item.localTitle);
  const markdown = buildMarkdownForPush(item.noteId, item.localTitle, item.localContent);
  const contentHash = await hashContent(markdown);

  const pushResult = await putFileContent(
    token,
    conn.repoOwner,
    conn.repoName,
    filePath,
    markdown,
    `sync: create ${filePath}`,
    conn.branch
  );

  const now = new Date();
  await db.insert(noteSyncState).values({
    connectionId: conn.id,
    noteId: item.noteId,
    filePath,
    lastContentHash: contentHash,
    lastRepoCommitSha: pushResult.commitSha,
    lastSyncedNoteUpdatedAt: item.localUpdatedAt,
    lastFileSha: pushResult.fileSha,
  });

  await logSyncEvent(db, conn.id, 'push', 'upsert', item.noteId, filePath, pushResult.commitSha, 'done');
  result.pushed.created++;
  result.details.push({ path: filePath, noteId: item.noteId, action: 'created', direction: 'push' });
}

async function applyLocalDeleted(
  db: Database,
  conn: ConnRow,
  token: string,
  item: SyncItem,
  commitSha: string | null,
  result: FullSyncResult
) {
  if (!item.filePath || !item.syncStateId) return;

  // Delete file from GitHub if we have the SHA
  const sha = item.remoteFileSha ?? item.lastFileSha;
  if (sha) {
    try {
      await deleteRepoFile(
        token,
        conn.repoOwner,
        conn.repoName,
        item.filePath,
        `sync: delete ${item.filePath}`,
        conn.branch,
        sha
      );
    } catch (err) {
      // 404 is OK — file already deleted
      if (err instanceof Error && !err.message.includes('404')) throw err;
    }
  }

  // Hard-delete the sync state row
  await db.delete(noteSyncState).where(eq(noteSyncState.id, item.syncStateId));

  await logSyncEvent(db, conn.id, 'push', 'delete', item.noteId, item.filePath, commitSha, 'done');
  result.pushed.deleted++;
  result.details.push({ path: item.filePath, noteId: item.noteId, action: 'deleted', direction: 'push' });
}

async function applyRemoteDeleted(
  db: Database,
  conn: ConnRow,
  item: SyncItem,
  commitSha: string | null,
  result: FullSyncResult
) {
  if (!item.syncStateId) return;

  // Unlink the note (don't delete it from DB)
  await db.delete(noteSyncState).where(eq(noteSyncState.id, item.syncStateId));

  await logSyncEvent(db, conn.id, 'pull', 'delete', item.noteId, item.filePath, commitSha, 'done');
  result.pulled.deleted++;
  result.details.push({ path: item.filePath, noteId: item.noteId, action: 'unlinked', direction: 'pull' });
}

// ── Legacy pull-only sync (backward compat) ──────────────────

export type SyncResult = {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  errors: number;
  details: Array<{ path: string; action: string; error?: string }>;
};

export async function executePull(
  db: Database,
  connectionId: string,
  userId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, deleted: 0, errors: 0, details: [] };

  const connRows = await db
    .select()
    .from(syncConnections)
    .where(and(eq(syncConnections.id, connectionId), eq(syncConnections.userId, userId)))
    .limit(1);

  const conn = connRows[0];
  if (!conn) throw new Error('Connection not found');
  if (conn.status !== 'active') throw new Error('Connection is paused');

  const token = await getGitHubAccessToken(db, userId);
  if (!token) throw new Error('GitHub access token not found. Please re-login with GitHub.');

  const commitSha = await getLatestCommitSha(token, conn.repoOwner, conn.repoName, conn.branch);
  const mdFiles = await collectMarkdownFiles(token, conn.repoOwner, conn.repoName, conn.basePath, conn.branch);

  const existingStates = await db
    .select()
    .from(noteSyncState)
    .where(and(eq(noteSyncState.connectionId, connectionId), isNull(noteSyncState.deletedAt)));

  const stateByPath = new Map(existingStates.map((s) => [s.filePath, s]));
  const processedPaths = new Set<string>();

  for (const mdFile of mdFiles) {
    const relativePath = mdFile.path;
    processedPaths.add(relativePath);

    try {
      const fileData = await getFileContent(token, conn.repoOwner, conn.repoName, mdFile.path, conn.branch);
      if (!fileData) {
        result.skipped++;
        result.details.push({ path: relativePath, action: 'skip', error: 'Could not fetch file content' });
        continue;
      }

      const rawContent = decodeBase64Content(fileData.content);
      const contentHash = await hashContent(rawContent);
      const parsed = parseMarkdown(rawContent, mdFile.name);

      const existingState = stateByPath.get(relativePath);

      if (existingState) {
        if (existingState.lastContentHash === contentHash) {
          result.skipped++;
          result.details.push({ path: relativePath, action: 'skip' });
          continue;
        }

        if (existingState.noteId) {
          const now = new Date();
          await db
            .update(notes)
            .set({ title: parsed.title, content: parsed.content, updatedAt: now })
            .where(eq(notes.id, existingState.noteId));

          await db
            .update(noteSyncState)
            .set({
              lastContentHash: contentHash,
              lastRepoCommitSha: commitSha,
              lastSyncedNoteUpdatedAt: now,
              lastFileSha: fileData.sha,
              updatedAt: now,
            })
            .where(eq(noteSyncState.id, existingState.id));
        }

        await logSyncEvent(db, connectionId, 'pull', 'upsert', existingState.noteId, relativePath, commitSha, 'done');
        result.updated++;
        result.details.push({ path: relativePath, action: 'updated' });
      } else {
        let noteId: string | null = null;

        if (parsed.carbonNoteId) {
          const existingNote = await db
            .select({ id: notes.id })
            .from(notes)
            .where(and(eq(notes.id, parsed.carbonNoteId), eq(notes.userId, userId)))
            .limit(1);

          if (existingNote[0]) {
            noteId = existingNote[0].id;
            await db
              .update(notes)
              .set({ title: parsed.title, content: parsed.content, updatedAt: new Date() })
              .where(eq(notes.id, noteId));
            result.updated++;
            result.details.push({ path: relativePath, action: 'updated' });
          }
        }

        if (!noteId) {
          const inserted = await db
            .insert(notes)
            .values({ userId, title: parsed.title, content: parsed.content })
            .returning({ id: notes.id });
          noteId = inserted[0].id;
          result.created++;
          result.details.push({ path: relativePath, action: 'created' });
        }

        const now = new Date();
        await db.insert(noteSyncState).values({
          connectionId,
          noteId,
          filePath: relativePath,
          lastContentHash: contentHash,
          lastRepoCommitSha: commitSha,
          lastSyncedNoteUpdatedAt: now,
          lastFileSha: fileData.sha,
        });

        await logSyncEvent(db, connectionId, 'pull', 'upsert', noteId, relativePath, commitSha, 'done');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors++;
      result.details.push({ path: relativePath, action: 'error', error: message });
      await logSyncEvent(db, connectionId, 'pull', 'upsert', null, relativePath, commitSha, 'error', message);
    }
  }

  for (const state of existingStates) {
    if (!processedPaths.has(state.filePath)) {
      result.deleted++;
      result.details.push({ path: state.filePath, action: 'deleted_from_repo' });
      await logSyncEvent(db, connectionId, 'pull', 'delete', state.noteId, state.filePath, commitSha, 'done');
      await db.delete(noteSyncState).where(eq(noteSyncState.id, state.id));
    }
  }

  await db
    .update(syncConnections)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(syncConnections.id, connectionId));

  return result;
}

// ── Logging ──────────────────────────────────────────────────

async function logSyncEvent(
  db: Database,
  connectionId: string,
  direction: string,
  eventType: string,
  noteId: string | null,
  filePath: string | null,
  commitSha: string | null,
  status: string,
  errorMessage?: string
) {
  await db.insert(syncEvents).values({
    connectionId,
    direction,
    eventType,
    noteId,
    filePath,
    commitSha,
    status,
    errorMessage: errorMessage ?? null,
  });
}
