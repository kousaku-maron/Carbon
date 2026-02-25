import { eq, and } from "drizzle-orm";
import { Hono } from "hono";
import { createAuth } from "./auth";
import { createDb, type Database } from "./db";
import { assets } from "../db/schema/app";
import { createSignedUrl, verifySignature } from "./signing";

type Bindings = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ASSET_BUCKET: R2Bucket;
  ASSET_SIGNING_SECRET: string;
  ASSET_MAX_IMAGE_BYTES: string;
};

type Env = { Bindings: Bindings };

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `as_${hex}`;
}

function generateObjectKey(userId: string, assetId: string, mimeType: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `u/${userId}/${year}/${month}/${assetId}.${ext}`;
}

async function requireAuth(c: { env: Bindings; req: { raw: Request } }) {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(c.env, db);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return null;
  return { user: session.user, db };
}

export const assetsApp = new Hono<Env>();

// POST /api/assets — Upload image
assetsApp.post("/", async (c) => {
  const authed = await requireAuth(c);
  if (!authed) return c.json({ error: "Unauthorized" }, 401);
  const { user, db } = authed;

  const maxBytes = parseInt(c.env.ASSET_MAX_IMAGE_BYTES || "5242880", 10);

  const formData = await c.req.raw.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return c.json({ error: "Missing file" }, 400);
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return c.json({ error: `Unsupported MIME type: ${file.type}` }, 400);
  }

  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    return c.json({ error: `File too large (max ${maxBytes} bytes)` }, 400);
  }

  const assetId = generateId();
  const objectKey = generateObjectKey(user.id, assetId, file.type);

  // Upload to R2
  await c.env.ASSET_BUCKET.put(objectKey, arrayBuffer, {
    httpMetadata: { contentType: file.type },
  });

  // Compute SHA-256
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Insert DB record
  await db.insert(assets).values({
    id: assetId,
    ownerUserId: user.id,
    objectKey,
    originalName: file.name || null,
    mimeType: file.type,
    sizeBytes: arrayBuffer.byteLength,
    sha256,
    status: "active",
  });

  const assetUri = `carbon://asset/${assetId}`;

  // Generate an initial signed URL for immediate display
  const baseUrl = c.env.BETTER_AUTH_URL;
  const { url: signedUrl, expiresAt } = await createSignedUrl(
    baseUrl,
    assetId,
    user.id,
    c.env.ASSET_SIGNING_SECRET,
  );

  return c.json({
    assetId,
    assetUri,
    signedUrl,
    expiresAt,
  });
});

// POST /api/assets/resolve — Resolve asset URIs to signed URLs
assetsApp.post("/resolve", async (c) => {
  const authed = await requireAuth(c);
  if (!authed) return c.json({ error: "Unauthorized" }, 401);
  const { user, db } = authed;

  const body = await c.req.json<{ assetIds: string[] }>();
  if (!Array.isArray(body.assetIds) || body.assetIds.length === 0) {
    return c.json({ error: "assetIds required" }, 400);
  }

  // Limit batch size
  if (body.assetIds.length > 50) {
    return c.json({ error: "Too many assetIds (max 50)" }, 400);
  }

  const baseUrl = c.env.BETTER_AUTH_URL;
  const items: { assetId: string; url: string; expiresAt: string }[] = [];

  for (const assetId of body.assetIds) {
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.ownerUserId, user.id), eq(assets.status, "active")));

    if (!asset) continue;

    const { url, expiresAt } = await createSignedUrl(baseUrl, assetId, user.id, c.env.ASSET_SIGNING_SECRET);
    items.push({ assetId, url, expiresAt });
  }

  return c.json({ items });
});

// GET /api/assets/:assetId/raw — Serve image via signed URL
assetsApp.get("/:assetId/raw", async (c) => {
  const { assetId } = c.req.param();
  const exp = c.req.query("exp");
  const sig = c.req.query("sig");

  if (!exp || !sig) {
    return c.json({ error: "Missing signature parameters" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);

  // Look up asset to get ownerUserId for verification
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.status, "active")));

  if (!asset) {
    return c.json({ error: "Asset not found" }, 404);
  }

  const valid = await verifySignature(assetId, asset.ownerUserId, exp, sig, c.env.ASSET_SIGNING_SECRET);
  if (!valid) {
    return c.json({ error: "Invalid or expired signature" }, 403);
  }

  const object = await c.env.ASSET_BUCKET.get(asset.objectKey);
  if (!object) {
    return c.json({ error: "Object not found in storage" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, max-age=60",
    },
  });
});

// DELETE /api/assets/:assetId — Soft delete
assetsApp.delete("/:assetId", async (c) => {
  const authed = await requireAuth(c);
  if (!authed) return c.json({ error: "Unauthorized" }, 401);
  const { user, db } = authed;

  const { assetId } = c.req.param();

  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.ownerUserId, user.id), eq(assets.status, "active")));

  if (!asset) {
    return c.json({ error: "Asset not found" }, 404);
  }

  // Delete from R2
  await c.env.ASSET_BUCKET.delete(asset.objectKey);

  // Soft delete in DB
  await db
    .update(assets)
    .set({ status: "deleted", deletedAt: new Date() })
    .where(eq(assets.id, assetId));

  return c.json({ ok: true });
});
