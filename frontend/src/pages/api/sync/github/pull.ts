import type { APIRoute } from 'astro';
import { z } from 'zod';
import { executePull } from '../../../../lib/server/sync';

const pullSchema = z.object({
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

  const parsed = pullSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request';
    return jsonError(400, message);
  }

  try {
    const result = await executePull(locals.db, parsed.data.connection_id, user.id);
    return Response.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return jsonError(500, message);
  }
};
