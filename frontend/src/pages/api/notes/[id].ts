import type { APIRoute } from 'astro';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { notes, noteSyncState } from '../../../../db/schema/app';
import { getNoteById, toNoteResponse } from '../../../lib/server/api';

const updateNoteSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).optional(),
  })
  .refine((value) => value.title !== undefined || value.content !== undefined, {
    message: 'At least one field is required',
  });

function jsonError(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

export const GET: APIRoute = async ({ params, locals }) => {
  const id = params.id;
  if (!id) return jsonError(400, 'Note ID is required');

  const user = locals.user;
  if (!user) {
    return jsonError(401, 'Unauthorized');
  }

  const note = await getNoteById(locals.db, id, user.id);
  if (!note) {
    return jsonError(404, 'Note not found');
  }

  return Response.json({
    success: true,
    data: {
      ...note,
      is_owner: true,
    },
  });
};

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const id = params.id;
  if (!id) return jsonError(400, 'Note ID is required');

  const user = locals.user;
  if (!user) {
    return jsonError(401, 'Unauthorized');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request';
    return jsonError(400, message);
  }

  const updates: Record<string, unknown> = { updatedAt: sql`now()` };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;

  const rows = await locals.db
    .update(notes)
    .set(updates)
    .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
    .returning();

  if (!rows[0]) {
    return jsonError(404, 'Note not found or forbidden');
  }

  return Response.json({ success: true, data: toNoteResponse(rows[0]) });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = params.id;
  if (!id) return jsonError(400, 'Note ID is required');

  const user = locals.user;
  if (!user) {
    return jsonError(401, 'Unauthorized');
  }

  // Mark sync state as soft-deleted before removing the note.
  // The FK on noteSyncState.noteId uses SET NULL, so the row survives
  // and the sync engine can push the deletion to GitHub.
  await locals.db
    .update(noteSyncState)
    .set({ deletedAt: new Date() })
    .where(eq(noteSyncState.noteId, id));

  const rows = await locals.db
    .delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
    .returning({ id: notes.id });

  if (!rows[0]) {
    return jsonError(404, 'Note not found or forbidden');
  }

  return Response.json({ success: true, data: { id } });
};
