import type { APIRoute } from 'astro';
import { and, eq, inArray } from 'drizzle-orm';
import { folders } from '../../../../db/schema/app';

function jsonError(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = params.id;
  if (!id) return jsonError(400, 'Folder ID is required');

  const user = locals.user;
  if (!user) {
    return jsonError(401, 'Unauthorized');
  }

  const rows = await locals.db
    .select({
      id: folders.id,
      parentId: folders.parentId,
    })
    .from(folders)
    .where(eq(folders.userId, user.id));

  if (!rows.some((row) => row.id === id)) {
    return jsonError(404, 'Folder not found or forbidden');
  }

  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const children = childrenByParent.get(row.parentId) ?? [];
    children.push(row.id);
    childrenByParent.set(row.parentId, children);
  }

  const targetIds = new Set<string>();
  const stack: string[] = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || targetIds.has(current)) continue;
    targetIds.add(current);

    const children = childrenByParent.get(current) ?? [];
    for (const childId of children) {
      stack.push(childId);
    }
  }

  const deleted = await locals.db
    .delete(folders)
    .where(and(eq(folders.userId, user.id), inArray(folders.id, Array.from(targetIds))))
    .returning({ id: folders.id });

  if (deleted.length === 0) {
    return jsonError(404, 'Folder not found or forbidden');
  }

  return Response.json({ success: true, data: { id, deleted_count: deleted.length } });
};
