import type { APIRoute } from 'astro';
import { z } from 'zod';
import { notes } from '../../../../db/schema/app';
import { getFolderByIdForUser, listNotes, toNoteResponse } from '../../../lib/server/api';

const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().optional().default(''),
  folder_id: z.uuid().nullable().optional(),
});

function jsonError(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return jsonError(401, 'Unauthorized');
  }

  const data = await listNotes(locals.db, user.id);
  return Response.json({ success: true, data });
};

export const POST: APIRoute = async ({ request, locals }) => {
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

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request';
    return jsonError(400, message);
  }

  const folderId = parsed.data.folder_id ?? null;

  if (folderId) {
    const folder = await getFolderByIdForUser(locals.db, folderId, user.id);
    if (!folder) {
      return jsonError(404, 'Folder not found');
    }
  }

  const rows = await locals.db
    .insert(notes)
    .values({
      userId: user.id,
      folderId,
      title: parsed.data.title,
      content: parsed.data.content,
    })
    .returning();

  return Response.json({ success: true, data: toNoteResponse(rows[0]) }, { status: 201 });
};
