import { defineMiddleware } from "astro:middleware";
import { createAuth } from "./lib/server/auth";
import { createDb } from "./lib/server/db";

export const onRequest = defineMiddleware(async ({ locals, request }, next) => {
  const env = locals.runtime.env;
  const db = createDb(env.DATABASE_URL);
  const trustedOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  locals.db = db;
  locals.auth = createAuth(
    {
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      githubClientId: env.GITHUB_CLIENT_ID,
      githubClientSecret: env.GITHUB_CLIENT_SECRET,
      trustedOrigins,
    },
    db
  );

  // user
  const isAuthed = await locals.auth.api.getSession({
    headers: request.headers,
  });

  locals.user = isAuthed?.user || null;
  locals.session = isAuthed?.session || null;

  const pathname = new URL(request.url).pathname;
  const isPrivateApi = pathname.startsWith('/api/notes') || pathname.startsWith('/api/folders') || pathname.startsWith('/api/sync');
  const isPrivatePage = pathname === '/' || pathname.startsWith('/notes');

  if (!locals.user) {
    if (isPrivateApi) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (isPrivatePage) {
      const loginUrl = new URL('/login', request.url);
      if (pathname !== '/') {
        loginUrl.searchParams.set('returnTo', pathname);
      }
      return Response.redirect(loginUrl, 302);
    }
  }

  return next();
});
