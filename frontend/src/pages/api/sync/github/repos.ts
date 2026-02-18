import type { APIRoute } from 'astro';
import { getGitHubAccessToken, listUserRepos } from '../../../../lib/server/github';

function jsonError(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return jsonError(401, 'Unauthorized');

  const token = await getGitHubAccessToken(locals.db, user.id);
  if (!token) {
    return jsonError(403, 'GitHub access token not found. Please re-login with GitHub.');
  }

  const repos = await listUserRepos(token);
  const data = repos.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    default_branch: r.default_branch,
  }));

  return Response.json({ success: true, data });
};
