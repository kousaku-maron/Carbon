import { and, asc, desc, eq } from 'drizzle-orm';
import { folders, notes } from '../../../../db/schema/app';
import type { Database } from '../db';

type FolderRow = typeof folders.$inferSelect;

export type FolderResponse = {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  created_at: Date;
  updated_at: Date;
};

export type SidebarNoteItem = {
  id: string;
  title: string;
};

export type SidebarFolderNode = {
  id: string;
  name: string;
  children: SidebarFolderNode[];
  notes: SidebarNoteItem[];
};

export type SidebarTree = {
  folders: SidebarFolderNode[];
  rootNotes: SidebarNoteItem[];
};

export function toFolderResponse(row: FolderRow): FolderResponse {
  return {
    id: row.id,
    user_id: row.userId,
    parent_id: row.parentId,
    name: row.name,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function listFoldersByUser(db: Database, userId: string): Promise<FolderResponse[]> {
  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(asc(folders.name), asc(folders.createdAt));

  return rows.map(toFolderResponse);
}

export async function getFolderByIdForUser(db: Database, id: string, userId: string): Promise<FolderResponse | null> {
  const rows = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.userId, userId)))
    .limit(1);

  const row = rows[0];
  return row ? toFolderResponse(row) : null;
}

export async function getSidebarTree(db: Database, userId: string): Promise<SidebarTree> {
  const [folderRows, noteRows] = await Promise.all([
    db
      .select({
        id: folders.id,
        name: folders.name,
        parentId: folders.parentId,
      })
      .from(folders)
      .where(eq(folders.userId, userId))
      .orderBy(asc(folders.name), asc(folders.createdAt)),
    db
      .select({
        id: notes.id,
        title: notes.title,
        folderId: notes.folderId,
      })
      .from(notes)
      .where(eq(notes.userId, userId))
      .orderBy(desc(notes.updatedAt)),
  ]);

  const folderMap = new Map<string, SidebarFolderNode & { parentId: string | null }>();
  for (const row of folderRows) {
    folderMap.set(row.id, {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      children: [],
      notes: [],
    });
  }

  const roots: (SidebarFolderNode & { parentId: string | null })[] = [];
  for (const node of folderMap.values()) {
    if (node.parentId && folderMap.has(node.parentId)) {
      folderMap.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const rootNotes: SidebarNoteItem[] = [];
  for (const note of noteRows) {
    const item: SidebarNoteItem = { id: note.id, title: note.title || 'Untitled' };
    if (note.folderId && folderMap.has(note.folderId)) {
      folderMap.get(note.folderId)!.notes.push(item);
    } else {
      rootNotes.push(item);
    }
  }

  const sortNode = (node: SidebarFolderNode & { parentId: string | null }) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    node.notes.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    node.children.forEach((child) => sortNode(child as SidebarFolderNode & { parentId: string | null }));
  };

  roots.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  roots.forEach(sortNode);
  rootNotes.sort((a, b) => a.title.localeCompare(b.title, 'ja'));

  const prune = (node: SidebarFolderNode & { parentId: string | null }): SidebarFolderNode => ({
    id: node.id,
    name: node.name,
    notes: node.notes,
    children: node.children.map((child) => prune(child as SidebarFolderNode & { parentId: string | null })),
  });

  return {
    folders: roots.map(prune),
    rootNotes,
  };
}
