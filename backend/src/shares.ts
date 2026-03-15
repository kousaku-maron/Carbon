import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { assets } from "../db/schema/app";
import { sharedDocumentAssets, sharedDocumentRevisions, sharedDocuments } from "../db/schema/share";
import { createAuth } from "./auth";
import { createDb, type Database } from "./db";
import { buildRenderedHtml, type ShareAssetRenderItem, type ShareLinkManifestItem, type ShareWarning } from "./share-render";
import { buildCarbonAssetWarning, mergeShareWarnings } from "./share-warnings";

type Bindings = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  PUBLIC_SHARE_BASE_URL?: string;
  CORS_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ASSET_BUCKET: R2Bucket;
  SHARE_BUCKET: R2Bucket;
};

type Env = { Bindings: Bindings };

type ShareAssetManifestItem = {
  clientAssetId: string;
  kind: string;
  sourceType: "local-file" | "carbon-asset";
  sourceRef: string;
  mimeType: string;
  title?: string | null;
  uploadField?: string;
  previewUploadField?: string;
  previewMimeType?: string | null;
};

type ShareMetadata = {
  title?: string;
  slug?: string;
  sourceVaultPath: string;
  sourceVaultName: string;
  sourceNotePath: string;
  markdownBody: string;
  ogImageUploadField?: string;
  ogImageMimeType?: string | null;
  linkManifest?: ShareLinkManifestItem[];
  assetManifest?: ShareAssetManifestItem[];
  warnings?: ShareWarning[];
};

const CURRENT_SUPPORTED_CARBON_ASSET_KINDS = new Set(["image"]);

function generateId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}_${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function getPublicBaseUrl(env: Bindings): string {
  return trimTrailingSlash(env.PUBLIC_SHARE_BASE_URL || env.BETTER_AUTH_URL);
}

function buildPublicUrl(env: Bindings, shareToken: string, slug: string): string {
  return `${getPublicBaseUrl(env)}/s/${shareToken}/${slug}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "shared-note";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExtensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "application/pdf") return "pdf";
  const [, subtype = "bin"] = mimeType.split("/");
  return subtype.replace(/[^a-z0-9]+/gi, "") || "bin";
}

function getDefaultTitle(sourceNotePath: string): string {
  const lastSegment = sourceNotePath.split("/").pop() ?? sourceNotePath;
  return lastSegment.replace(/\.md$/i, "") || "Shared note";
}

function isFatalWarning(warning: ShareWarning): boolean {
  return warning.severity === "error";
}

function getFatalWarnings(metadata: ShareMetadata): ShareWarning[] {
  return (metadata.warnings ?? []).filter(isFatalWarning);
}

async function requireAuth(c: { env: Bindings; req: { raw: Request } }) {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(c.env, db);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return null;
  return { user: session.user, db };
}

async function parseMetadata(formData: FormData): Promise<ShareMetadata> {
  const rawMetadata = formData.get("metadata");
  if (typeof rawMetadata !== "string" || !rawMetadata.trim()) {
    throw new Error("Missing metadata");
  }

  const parsed = JSON.parse(rawMetadata) as ShareMetadata;
  if (
    !parsed.sourceVaultPath ||
    !parsed.sourceVaultName ||
    !parsed.sourceNotePath ||
    !parsed.markdownBody
  ) {
    throw new Error(
      "sourceVaultPath, sourceVaultName, sourceNotePath and markdownBody are required",
    );
  }

  for (const asset of parsed.assetManifest ?? []) {
    if (asset.sourceType !== "carbon-asset") continue;
    if (CURRENT_SUPPORTED_CARBON_ASSET_KINDS.has(asset.kind)) continue;
    throw new Error("Only image carbon://asset references are currently supported");
  }

  return parsed;
}

async function resolveLinkManifest(
  db: Database,
  ownerUserId: string,
  sourceVaultPath: string,
  linkManifest: ShareLinkManifestItem[] | undefined,
  env: Bindings,
): Promise<ShareLinkManifestItem[]> {
  if (!linkManifest?.length) return [];

  const resolved: ShareLinkManifestItem[] = [];
  for (const item of linkManifest) {
    if (item.kind !== "note-link" || !item.targetNotePath) {
      resolved.push(item);
      continue;
    }

    const [linkedShare] = await db
      .select()
      .from(sharedDocuments)
      .where(
        and(
          eq(sharedDocuments.ownerUserId, ownerUserId),
          eq(sharedDocuments.sourceVaultPath, sourceVaultPath),
          eq(sharedDocuments.sourceNotePath, item.targetNotePath),
          eq(sharedDocuments.status, "active"),
        ),
      )
      .orderBy(desc(sharedDocuments.updatedAt));

    resolved.push({
      ...item,
      publicUrl: linkedShare ? buildPublicUrl(env, linkedShare.shareToken, linkedShare.slug) : null,
    });
  }

  return resolved;
}

async function prepareShareAssets(input: {
  env: Bindings;
  db: Database;
  userId: string;
  shareId: string;
  revisionId: string;
  shareToken: string;
  formData: FormData;
  assetManifest?: ShareAssetManifestItem[];
}): Promise<{
  assetRows: Array<typeof sharedDocumentAssets.$inferInsert>;
  assetRenderItems: ShareAssetRenderItem[];
  warnings: ShareWarning[];
}> {
  const assetRows: Array<typeof sharedDocumentAssets.$inferInsert> = [];
  const assetRenderItems: ShareAssetRenderItem[] = [];
  const warnings: ShareWarning[] = [];

  for (const asset of input.assetManifest ?? []) {
    const shareAssetId = generateId("sha");
    let bytes: ArrayBuffer;
    let mimeType = asset.mimeType;
    let previewImageUrl: string | null = null;

    if (asset.sourceType === "local-file") {
      const fieldName = asset.uploadField || `file_${asset.clientAssetId}`;
      const file = input.formData.get(fieldName);
      if (!(file instanceof File)) {
        throw new Error(`Missing upload for ${asset.sourceRef}`);
      }
      bytes = await file.arrayBuffer();
      mimeType = file.type || mimeType || "application/octet-stream";
    } else {
      const assetId = asset.sourceRef.replace(/^carbon:\/\/asset\//, "");
      const [sourceAsset] = await input.db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.ownerUserId, input.userId),
            eq(assets.status, "active"),
          ),
        );

      if (!sourceAsset) {
        warnings.push(buildCarbonAssetWarning(asset.sourceRef, "inaccessible"));
        continue;
      }

      const object = await input.env.ASSET_BUCKET.get(sourceAsset.objectKey);
      if (!object) {
        warnings.push(buildCarbonAssetWarning(asset.sourceRef, "missing-object"));
        continue;
      }

      bytes = await object.arrayBuffer();
      mimeType = sourceAsset.mimeType;
    }

    const objectKey = `shares/${input.shareId}/${input.revisionId}/${shareAssetId}.${getExtensionFromMimeType(
      mimeType || "application/octet-stream",
    )}`;

    await input.env.SHARE_BUCKET.put(objectKey, bytes, {
      httpMetadata: { contentType: mimeType || "application/octet-stream" },
    });

    const publicUrl = `${getPublicBaseUrl(input.env)}/s/${input.shareToken}/assets/${shareAssetId}`;

    if (asset.kind === "pdf" && asset.previewUploadField) {
      const previewFile = input.formData.get(asset.previewUploadField);
      if (previewFile instanceof File) {
        const previewAssetId = generateId("sha");
        const previewMimeType = previewFile.type || asset.previewMimeType || "image/png";
        const previewBytes = await previewFile.arrayBuffer();
        const previewObjectKey = `shares/${input.shareId}/${input.revisionId}/${previewAssetId}.${getExtensionFromMimeType(
          previewMimeType,
        )}`;

        await input.env.SHARE_BUCKET.put(previewObjectKey, previewBytes, {
          httpMetadata: { contentType: previewMimeType },
        });

        previewImageUrl = `${getPublicBaseUrl(input.env)}/s/${input.shareToken}/assets/${previewAssetId}`;
        assetRows.push({
          id: previewAssetId,
          sharedDocumentId: input.shareId,
          sharedDocumentRevisionId: input.revisionId,
          kind: "pdf-preview",
          sourceType: "generated-preview",
          sourceRef: `${asset.sourceRef}#preview`,
          title: asset.title ?? null,
          objectKey: previewObjectKey,
          mimeType: previewMimeType,
          sizeBytes: previewBytes.byteLength,
        });
      }
    }

    assetRows.push({
      id: shareAssetId,
      sharedDocumentId: input.shareId,
      sharedDocumentRevisionId: input.revisionId,
      kind: asset.kind,
      sourceType: asset.sourceType,
      sourceRef: asset.sourceRef,
      title: asset.title ?? null,
      objectKey,
      mimeType: mimeType || "application/octet-stream",
      sizeBytes: bytes.byteLength,
    });
    assetRenderItems.push({
      kind: asset.kind,
      sourceRef: asset.sourceRef,
      title: asset.title ?? null,
      publicUrl,
      previewImageUrl,
    });
  }

  return { assetRows, assetRenderItems, warnings };
}

async function prepareOgImageAsset(input: {
  env: Bindings;
  shareId: string;
  revisionId: string;
  shareToken: string;
  formData: FormData;
  metadata: ShareMetadata;
}): Promise<{
  assetRow: typeof sharedDocumentAssets.$inferInsert | null;
  publicUrl: string | null;
}> {
  const fieldName = input.metadata.ogImageUploadField;
  if (!fieldName) {
    return { assetRow: null, publicUrl: null };
  }

  const file = input.formData.get(fieldName);
  if (!(file instanceof File)) {
    return { assetRow: null, publicUrl: null };
  }

  const bytes = await file.arrayBuffer();
  const mimeType = file.type || input.metadata.ogImageMimeType || "image/png";
  const assetId = generateId("sha");
  const objectKey = `shares/${input.shareId}/${input.revisionId}/${assetId}.${getExtensionFromMimeType(mimeType)}`;

  await input.env.SHARE_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: mimeType },
  });

  return {
    assetRow: {
      id: assetId,
      sharedDocumentId: input.shareId,
      sharedDocumentRevisionId: input.revisionId,
      kind: "og-image",
      sourceType: "generated",
      sourceRef: "__generated/og-image",
      title: input.metadata.title ?? null,
      objectKey,
      mimeType,
      sizeBytes: bytes.byteLength,
    },
    publicUrl: `${getPublicBaseUrl(input.env)}/s/${input.shareToken}/assets/${assetId}`,
  };
}

async function createRevision(input: {
  env: Bindings;
  db: Database;
  userId: string;
  formData: FormData;
  shareId: string;
  shareToken: string;
  title: string;
  slug: string;
  metadata: ShareMetadata;
}) {
  const revisionId = generateId("shr");
  const resolvedLinks = await resolveLinkManifest(
    input.db,
    input.userId,
    input.metadata.sourceVaultPath,
    input.metadata.linkManifest,
    input.env,
  );
  const { assetRows, assetRenderItems, warnings: assetWarnings } = await prepareShareAssets({
    env: input.env,
    db: input.db,
    userId: input.userId,
    shareId: input.shareId,
    revisionId,
    shareToken: input.shareToken,
    formData: input.formData,
    assetManifest: input.metadata.assetManifest,
  });
  const ogImage = await prepareOgImageAsset({
    env: input.env,
    shareId: input.shareId,
    revisionId,
    shareToken: input.shareToken,
    formData: input.formData,
    metadata: input.metadata,
  });
  if (ogImage.assetRow) {
    assetRows.push(ogImage.assetRow);
  }

  const renderedHtml = buildRenderedHtml({
    title: input.title,
    markdownBody: input.metadata.markdownBody,
    assets: assetRenderItems,
    links: resolvedLinks,
    publicUrl: buildPublicUrl(input.env, input.shareToken, input.slug),
    ogImageUrl: ogImage.publicUrl,
  });

  const allWarnings = mergeShareWarnings(input.metadata.warnings, assetWarnings);

  const summaryJson = JSON.stringify({
    warnings: allWarnings,
    assets: assetRows.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      sourceType: asset.sourceType,
      sourceRef: asset.sourceRef,
      title: asset.title,
      mimeType: asset.mimeType,
    })),
    links: resolvedLinks,
  });

  await input.db.insert(sharedDocumentRevisions).values({
    id: revisionId,
    sharedDocumentId: input.shareId,
    markdownBody: input.metadata.markdownBody,
    renderedHtml,
    summaryJson,
  });

  if (assetRows.length > 0) {
    await input.db.insert(sharedDocumentAssets).values(assetRows);
  }

  return {
    revisionId,
    assetRows,
    warningCount: allWarnings.length,
  };
}

async function findOwnedShare(db: Database, ownerUserId: string, shareId: string) {
  const [share] = await db
    .select()
    .from(sharedDocuments)
    .where(and(eq(sharedDocuments.id, shareId), eq(sharedDocuments.ownerUserId, ownerUserId)));
  return share ?? null;
}

function buildShareSummary(env: Bindings, share: typeof sharedDocuments.$inferSelect) {
  return {
    id: share.id,
    title: share.title,
    slug: share.slug,
    shareToken: share.shareToken,
    publicUrl: buildPublicUrl(env, share.shareToken, share.slug),
    status: share.status,
    sourceVaultPath: share.sourceVaultPath,
    sourceVaultName: share.sourceVaultName,
    sourceNotePath: share.sourceNotePath,
    currentRevisionId: share.currentRevisionId,
    createdAt: share.createdAt.toISOString(),
    updatedAt: share.updatedAt.toISOString(),
    revokedAt: share.revokedAt?.toISOString() ?? null,
  };
}

export const sharesApp = new Hono<Env>();
export const sharePublicApp = new Hono<Env>();

sharesApp.get("/", async (c) => {
  const authed = await requireAuth(c);
  if (!authed) return c.json({ error: "Unauthorized" }, 401);

  const status = c.req.query("status") ?? "active";
  const sourceVaultPath = c.req.query("sourceVaultPath");
  const sourceNotePath = c.req.query("sourceNotePath");
  const documents = await authed.db
    .select()
    .from(sharedDocuments)
    .where(eq(sharedDocuments.ownerUserId, authed.user.id))
    .orderBy(desc(sharedDocuments.updatedAt));

  const filtered = documents.filter((share) => {
    if (status !== "all" && share.status !== status) return false;
    if (sourceVaultPath && share.sourceVaultPath !== sourceVaultPath) {
      return false;
    }
    if (sourceNotePath && share.sourceNotePath !== sourceNotePath) return false;
    return true;
  });

  return c.json({
    items: filtered.map((share) => buildShareSummary(c.env, share)),
  });
});

sharesApp.get("/:shareId", async (c) => {
  const authed = await requireAuth(c);
  if (!authed) return c.json({ error: "Unauthorized" }, 401);

  const share = await findOwnedShare(authed.db, authed.user.id, c.req.param("shareId"));
  if (!share) return c.json({ error: "Share not found" }, 404);

  const [revision] = share.currentRevisionId
    ? await authed.db
        .select()
        .from(sharedDocumentRevisions)
        .where(eq(sharedDocumentRevisions.id, share.currentRevisionId))
    : [];
  const assetsForRevision = share.currentRevisionId
    ? await authed.db
        .select()
        .from(sharedDocumentAssets)
        .where(eq(sharedDocumentAssets.sharedDocumentRevisionId, share.currentRevisionId))
    : [];

  return c.json({
    share: buildShareSummary(c.env, share),
    latestRevision: revision
      ? {
          id: revision.id,
          createdAt: revision.createdAt.toISOString(),
          summary: JSON.parse(revision.summaryJson),
        }
      : null,
    assets: assetsForRevision.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      sourceType: asset.sourceType,
      sourceRef: asset.sourceRef,
      title: asset.title,
      mimeType: asset.mimeType,
      publicUrl: `${getPublicBaseUrl(c.env)}/s/${share.shareToken}/assets/${asset.id}`,
    })),
  });
});

sharesApp.post("/", async (c) => {
  const authed = await requireAuth(c);
  if (!authed) return c.json({ error: "Unauthorized" }, 401);

  const formData = await c.req.raw.formData();
  let metadata: ShareMetadata;
  try {
    metadata = await parseMetadata(formData);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid metadata" }, 400);
  }

  const fatalWarnings = getFatalWarnings(metadata);
  if (fatalWarnings.length > 0) {
    return c.json({ error: "Share contains fatal issues", warnings: fatalWarnings }, 422);
  }

  const [existingShare] = await authed.db
    .select()
    .from(sharedDocuments)
    .where(
      and(
        eq(sharedDocuments.ownerUserId, authed.user.id),
        eq(sharedDocuments.sourceVaultPath, metadata.sourceVaultPath),
        eq(sharedDocuments.sourceNotePath, metadata.sourceNotePath),
        eq(sharedDocuments.status, "active"),
      ),
    )
    .orderBy(desc(sharedDocuments.updatedAt));

  if (existingShare) {
    return c.json({ error: "Active share already exists for this note" }, 409);
  }

  const shareId = generateId("sh");
  const shareToken = generateId("st");
  const title = metadata.title?.trim() || getDefaultTitle(metadata.sourceNotePath);
  const slug = slugify(metadata.slug?.trim() || title);

  await authed.db.insert(sharedDocuments).values({
    id: shareId,
    ownerUserId: authed.user.id,
    shareToken,
    slug,
    title,
    sourceVaultPath: metadata.sourceVaultPath,
    sourceVaultName: metadata.sourceVaultName,
    sourceNotePath: metadata.sourceNotePath,
    status: "active",
    visibility: "unlisted",
  });

  try {
    const revision = await createRevision({
      env: c.env,
      db: authed.db,
      userId: authed.user.id,
      formData,
      shareId,
      shareToken,
      title,
      slug,
      metadata,
    });

    await authed.db
      .update(sharedDocuments)
      .set({
        title,
        slug,
        currentRevisionId: revision.revisionId,
        updatedAt: new Date(),
      })
      .where(eq(sharedDocuments.id, shareId));

    const share = await findOwnedShare(authed.db, authed.user.id, shareId);
    if (!share) {
      return c.json({ error: "Share not found after create" }, 500);
    }

    return c.json({
      share: buildShareSummary(c.env, share),
      revision: {
        id: revision.revisionId,
        assetCount: revision.assetRows.length,
        warningCount: revision.warningCount,
      },
    });
  } catch (error) {
    await authed.db.delete(sharedDocuments).where(eq(sharedDocuments.id, shareId));
    return c.json({ error: error instanceof Error ? error.message : "Failed to create share" }, 400);
  }
});

sharesApp.post("/:shareId/republish", async (c) => {
  const authed = await requireAuth(c);
  if (!authed) return c.json({ error: "Unauthorized" }, 401);

  const share = await findOwnedShare(authed.db, authed.user.id, c.req.param("shareId"));
  if (!share) return c.json({ error: "Share not found" }, 404);
  if (share.status !== "active") return c.json({ error: "Share is not active" }, 409);

  const formData = await c.req.raw.formData();
  let metadata: ShareMetadata;
  try {
    metadata = await parseMetadata(formData);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid metadata" }, 400);
  }

  const fatalWarnings = getFatalWarnings(metadata);
  if (fatalWarnings.length > 0) {
    return c.json({ error: "Share contains fatal issues", warnings: fatalWarnings }, 422);
  }

  const title = metadata.title?.trim() || share.title;
  const slug = slugify(metadata.slug?.trim() || share.slug);

  try {
    const revision = await createRevision({
      env: c.env,
      db: authed.db,
      userId: authed.user.id,
      formData,
      shareId: share.id,
      shareToken: share.shareToken,
      title,
      slug,
      metadata,
    });

    await authed.db
      .update(sharedDocuments)
      .set({
        title,
        slug,
        sourceVaultPath: metadata.sourceVaultPath,
        sourceVaultName: metadata.sourceVaultName,
        sourceNotePath: metadata.sourceNotePath,
        currentRevisionId: revision.revisionId,
        updatedAt: new Date(),
      })
      .where(eq(sharedDocuments.id, share.id));

    const updatedShare = await findOwnedShare(authed.db, authed.user.id, share.id);
    if (!updatedShare) {
      return c.json({ error: "Share not found after republish" }, 500);
    }

    return c.json({
      share: buildShareSummary(c.env, updatedShare),
      revision: {
        id: revision.revisionId,
        assetCount: revision.assetRows.length,
        warningCount: revision.warningCount,
      },
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to republish share" }, 400);
  }
});

sharesApp.post("/:shareId/revoke", async (c) => {
  const authed = await requireAuth(c);
  if (!authed) return c.json({ error: "Unauthorized" }, 401);

  const share = await findOwnedShare(authed.db, authed.user.id, c.req.param("shareId"));
  if (!share) return c.json({ error: "Share not found" }, 404);
  if (share.status === "revoked") {
    return c.json({ ok: true, status: "revoked" });
  }

  const shareAssets = await authed.db
    .select()
    .from(sharedDocumentAssets)
    .where(eq(sharedDocumentAssets.sharedDocumentId, share.id));

  for (const asset of shareAssets) {
    await c.env.SHARE_BUCKET.delete(asset.objectKey);
  }

  await authed.db
    .update(sharedDocuments)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sharedDocuments.id, share.id));

  return c.json({ ok: true, status: "revoked" });
});

sharePublicApp.get("/:shareToken/assets/:assetId", async (c) => {
  const { shareToken, assetId } = c.req.param();
  const [share] = await createDb(c.env.DATABASE_URL)
    .select()
    .from(sharedDocuments)
    .where(eq(sharedDocuments.shareToken, shareToken));

  if (!share) return c.json({ error: "Share not found" }, 404);
  if (share.status === "revoked") return c.body(null, 410);
  if (!share.currentRevisionId) return c.json({ error: "Share revision missing" }, 404);

  const [asset] = await createDb(c.env.DATABASE_URL)
    .select()
    .from(sharedDocumentAssets)
    .where(
      and(
        eq(sharedDocumentAssets.id, assetId),
        eq(sharedDocumentAssets.sharedDocumentId, share.id),
        eq(sharedDocumentAssets.sharedDocumentRevisionId, share.currentRevisionId),
      ),
    );

  if (!asset) return c.json({ error: "Asset not found" }, 404);

  const object = await c.env.SHARE_BUCKET.get(asset.objectKey);
  if (!object) return c.json({ error: "Asset object missing" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": "inline",
      "Content-Length": String(asset.sizeBytes),
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
});

async function renderPublicDocument(c: any) {
  const { shareToken } = c.req.param();
  const db = createDb(c.env.DATABASE_URL);
  const [share] = await db
    .select()
    .from(sharedDocuments)
    .where(eq(sharedDocuments.shareToken, shareToken));

  if (!share) return c.json({ error: "Share not found" }, 404);
  if (share.status === "revoked") return c.body(null, 410);
  if (!share.currentRevisionId) return c.json({ error: "Share revision missing" }, 404);

  const [revision] = await db
    .select()
    .from(sharedDocumentRevisions)
    .where(eq(sharedDocumentRevisions.id, share.currentRevisionId));

  if (!revision) return c.json({ error: "Share revision missing" }, 404);

  return c.html(revision.renderedHtml, 200, {
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
}

sharePublicApp.get("/:shareToken", renderPublicDocument);
sharePublicApp.get("/:shareToken/:slug", renderPublicDocument);
