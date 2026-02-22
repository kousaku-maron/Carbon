import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { createDb } from "./db";

type Bindings = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGINS: string;
};

type Env = { Bindings: Bindings };

const app = new Hono<Env>();

function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

app.use("*", async (c, next) => {
  const allowedOrigins = parseOrigins(c.env.CORS_ORIGINS);

  return cors({
    origin: (origin) => {
      if (!origin) {
        return allowedOrigins[0] || c.env.BETTER_AUTH_URL;
      }
      return allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0] || c.env.BETTER_AUTH_URL;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })(c, next);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.all("/api/auth/*", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(c.env, db);
  return auth.handler(c.req.raw);
});

app.get("/api/me", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(c.env, db);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user) {
    return c.json({ user: null });
  }

  return c.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
  });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
