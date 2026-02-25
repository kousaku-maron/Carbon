import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createAuth } from "./auth";
import { createDb } from "./db";
import { verification } from "../db/schema/auth";

type Bindings = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AUTH_EXCHANGE_ENABLED?: string;
};

type Env = { Bindings: Bindings };

export const desktopAuthApp = new Hono<Env>();

// GET /api/desktop-auth/google — Initiate Google sign-in via system browser
desktopAuthApp.get("/google", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(c.env, db);

  const exchangeEnabled = c.env.AUTH_EXCHANGE_ENABLED === "true";
  const exchange = exchangeEnabled ? c.req.query("exchange") : undefined;
  const baseURL = c.env.BETTER_AUTH_URL;
  const callbackPath = exchange
    ? `/api/desktop-auth/callback?exchange=${encodeURIComponent(exchange)}`
    : "/api/desktop-auth/callback";

  const url = new URL("/api/auth/sign-in/social", c.req.url);
  const internalReq = new Request(url, {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      provider: "google",
      callbackURL: `${baseURL}${callbackPath}`,
    }),
  });

  const res = await auth.handler(internalReq);

  const body = await res.json<{ url?: string }>();
  if (!body.url) {
    return c.text("Failed to initiate Google sign-in", 500);
  }

  const response = c.redirect(body.url);
  for (const value of res.headers.getSetCookie()) {
    response.headers.append("Set-Cookie", value);
  }
  return response;
});

// GET /api/desktop-auth/callback — OAuth callback, redirect to app via deep link
desktopAuthApp.get("/callback", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(c.env, db);

  const sessionData = await auth.api.getSession({ headers: c.req.raw.headers });
  const token = sessionData?.session?.token;

  if (!token) {
    return c.html(
      "<html><body><p>Authentication failed. Please close this window and try again.</p></body></html>",
      401,
    );
  }

  // Store token for polling (DEV mode when deep links are unavailable)
  const exchangeEnabled = c.env.AUTH_EXCHANGE_ENABLED === "true";
  const exchange = exchangeEnabled ? c.req.query("exchange") : undefined;
  if (exchange) {
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `exchange:${exchange}`,
      value: token,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
  }

  const deepLink = `carbon://callback?token=${encodeURIComponent(token)}`;

  return c.html(`<!DOCTYPE html>
<html><head><title>Authentication Successful</title></head>
<body>
  <p>Authentication successful! Returning to the app...</p>
  <p>If the app doesn't open automatically, <a href="${deepLink}">click here</a>.</p>
  <script>window.location.href = "${deepLink}";</script>
</body></html>`);
});

// GET /api/desktop-auth/exchange — Poll for token (DEV mode only)
desktopAuthApp.get("/exchange", async (c) => {
  if (c.env.AUTH_EXCHANGE_ENABLED !== "true") {
    return c.json({ error: "Exchange not enabled" }, 404);
  }

  const code = c.req.query("code");
  if (!code) return c.json({ token: null }, 400);

  const db = createDb(c.env.DATABASE_URL);
  const identifier = `exchange:${code}`;
  const rows = await db
    .select()
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ token: null });
  if (row.expiresAt < new Date()) {
    await db.delete(verification).where(eq(verification.id, row.id));
    return c.json({ token: null });
  }

  // One-time use: delete after retrieval
  await db.delete(verification).where(eq(verification.id, row.id));
  return c.json({ token: row.value });
});
