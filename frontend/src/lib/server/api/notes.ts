import { and, desc, eq } from 'drizzle-orm';
import { notes } from '../../../../db/schema/app';
import type { Database } from '../db';

type NoteRow = typeof notes.$inferSelect;

export type NoteResponse = {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  created_at: Date;
  updated_at: Date;
};

export function toNoteResponse(row: NoteRow): NoteResponse {
  return {
    id: row.id,
    user_id: row.userId,
    folder_id: row.folderId,
    title: row.title,
    content: row.content,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function listNotes(db: Database, userId: string): Promise<NoteResponse[]> {
  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.createdAt));

  return rows.map(toNoteResponse);
}

export async function getNoteById(db: Database, id: string, userId: string): Promise<NoteResponse | null> {
  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .limit(1);

  const row = rows[0];
  return row ? toNoteResponse(row) : null;
}
