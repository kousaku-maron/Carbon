import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { syncConnections } from '../../../../../db/schema/app';

const disconnectSchema = z.object({
  connection_id: z.uuid(),
});

function jsonError(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return jsonError(401, 'Unauthorized');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const parsed = disconnectSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request';
    return jsonError(400, message);
  }

  const rows = await locals.db
    .delete(syncConnections)
    .where(and(eq(syncConnections.id, parsed.data.connection_id), eq(syncConnections.userId, user.id)))
    .returning({ id: syncConnections.id });

  if (!rows[0]) {
    return jsonError(404, 'Connection not found');
  }

  return Response.json({ success: true, data: { id: rows[0].id } });
};
