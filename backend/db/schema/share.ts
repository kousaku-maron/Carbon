import { bigint, index, text, timestamp, pgTable } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const sharedDocuments = pgTable(
  "shared_documents",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    shareToken: text("share_token").notNull().unique(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    sourceVaultPath: text("source_vault_path").notNull(),
    sourceVaultName: text("source_vault_name").notNull(),
    sourceNotePath: text("source_note_path").notNull(),
    status: text("status").notNull().default("active"),
    visibility: text("visibility").notNull().default("unlisted"),
    currentRevisionId: text("current_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("shared_documents_owner_user_id_idx").on(table.ownerUserId),
    index("shared_documents_source_vault_path_idx").on(table.sourceVaultPath),
    index("shared_documents_source_note_path_idx").on(table.sourceNotePath),
  ],
);

export const sharedDocumentRevisions = pgTable(
  "shared_document_revisions",
  {
    id: text("id").primaryKey(),
    sharedDocumentId: text("shared_document_id")
      .notNull()
      .references(() => sharedDocuments.id, { onDelete: "cascade" }),
    markdownBody: text("markdown_body").notNull(),
    renderedHtml: text("rendered_html").notNull(),
    summaryJson: text("summary_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("shared_document_revisions_document_id_idx").on(table.sharedDocumentId)],
);

export const sharedDocumentAssets = pgTable(
  "shared_document_assets",
  {
    id: text("id").primaryKey(),
    sharedDocumentId: text("shared_document_id")
      .notNull()
      .references(() => sharedDocuments.id, { onDelete: "cascade" }),
    sharedDocumentRevisionId: text("shared_document_revision_id")
      .notNull()
      .references(() => sharedDocumentRevisions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    title: text("title"),
    objectKey: text("object_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shared_document_assets_document_id_idx").on(table.sharedDocumentId),
    index("shared_document_assets_revision_id_idx").on(table.sharedDocumentRevisionId),
  ],
);
