import type { APIRoute } from 'astro';
import { z } from 'zod';
import { folders } from '../../../../db/schema/app';
import { getFolderByIdForUser, listFoldersByUser, toFolderResponse } from '../../../lib/server/api';

const createFolderSchema = z.object({
  name: z.string().min(1).max(120),
  parent_id: z.uuid().nullable().optional(),
});

function jsonError(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return jsonError(401, 'Unauthorized');
  }

  const data = await listFoldersByUser(locals.db, user.id);
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

  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request';
    return jsonError(400, message);
  }

  const parentId = parsed.data.parent_id ?? null;
  if (parentId) {
    const parent = await getFolderByIdForUser(locals.db, parentId, user.id);
    if (!parent) {
      return jsonError(404, 'Parent folder not found');
    }
  }

  const rows = await locals.db
    .insert(folders)
    .values({
      userId: user.id,
      parentId,
      name: parsed.data.name.trim(),
    })
    .returning();

  return Response.json({ success: true, data: toFolderResponse(rows[0]) }, { status: 201 });
};
