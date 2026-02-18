import type { APIRoute } from 'astro';
import { desc, eq } from 'drizzle-orm';
import { syncConnections, syncEvents } from '../../../../../db/schema/app';

function jsonError(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return jsonError(401, 'Unauthorized');

  const connections = await locals.db
    .select()
    .from(syncConnections)
    .where(eq(syncConnections.userId, user.id));

  const data = await Promise.all(
    connections.map(async (conn) => {
      const recentEvents = await locals.db
        .select()
        .from(syncEvents)
        .where(eq(syncEvents.connectionId, conn.id))
        .orderBy(desc(syncEvents.createdAt))
        .limit(20);

      return {
        id: conn.id,
        repo_owner: conn.repoOwner,
        repo_name: conn.repoName,
        branch: conn.branch,
        base_path: conn.basePath,
        status: conn.status,
        last_synced_at: conn.lastSyncedAt,
        created_at: conn.createdAt,
        recent_events: recentEvents.map((e) => ({
          id: e.id,
          direction: e.direction,
          event_type: e.eventType,
          file_path: e.filePath,
          status: e.status,
          error_message: e.errorMessage,
          created_at: e.createdAt,
        })),
      };
    })
  );

  return Response.json({ success: true, data });
};
