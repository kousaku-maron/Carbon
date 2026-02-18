import type { APIRoute } from 'astro';
import { z } from 'zod';
import { executeSync, LocalWinsStrategy, RemoteWinsStrategy } from '../../../../lib/server/sync';

const syncSchema = z.object({
  connection_id: z.uuid(),
  strategy: z.enum(['local_wins', 'remote_wins']).optional().default('local_wins'),
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

  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request';
    return jsonError(400, message);
  }

  const strategy = parsed.data.strategy === 'remote_wins'
    ? new RemoteWinsStrategy()
    : new LocalWinsStrategy();

  try {
    const result = await executeSync(locals.db, parsed.data.connection_id, user.id, strategy);
    return Response.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return jsonError(500, message);
  }
};
