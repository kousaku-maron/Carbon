import type { APIRoute } from 'astro';
import { z } from 'zod';
import { syncConnections } from '../../../../../db/schema/app';
import { getGitHubAccessToken, verifyRepoAccess } from '../../../../lib/server/github';

const connectSchema = z.object({
  repo_owner: z.string().min(1),
  repo_name: z.string().min(1),
  branch: z.string().min(1).optional().default('main'),
  base_path: z.string().optional().default(''),
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

  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request';
    return jsonError(400, message);
  }

  const token = await getGitHubAccessToken(locals.db, user.id);
  if (!token) {
    return jsonError(403, 'GitHub access token not found. Please re-login with GitHub.');
  }

  // Verify access to the repository
  const hasAccess = await verifyRepoAccess(token, parsed.data.repo_owner, parsed.data.repo_name);
  if (!hasAccess) {
    return jsonError(403, 'Cannot access repository. Check permissions.');
  }

  try {
    const rows = await locals.db
      .insert(syncConnections)
      .values({
        userId: user.id,
        repoOwner: parsed.data.repo_owner,
        repoName: parsed.data.repo_name,
        branch: parsed.data.branch,
        basePath: parsed.data.base_path,
      })
      .onConflictDoUpdate({
        target: [syncConnections.userId, syncConnections.repoOwner, syncConnections.repoName],
        set: {
          branch: parsed.data.branch,
          basePath: parsed.data.base_path,
          status: 'active',
          updatedAt: new Date(),
        },
      })
      .returning();

    const conn = rows[0];
    return Response.json(
      {
        success: true,
        data: {
          id: conn.id,
          repo_owner: conn.repoOwner,
          repo_name: conn.repoName,
          branch: conn.branch,
          base_path: conn.basePath,
          status: conn.status,
          last_synced_at: conn.lastSyncedAt,
          created_at: conn.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create connection';
    return jsonError(500, message);
  }
};
