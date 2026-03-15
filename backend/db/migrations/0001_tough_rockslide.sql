CREATE TABLE "shared_document_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"shared_document_id" text NOT NULL,
	"shared_document_revision_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"title" text,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_document_assets_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "shared_document_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"shared_document_id" text NOT NULL,
	"markdown_body" text NOT NULL,
	"rendered_html" text NOT NULL,
	"summary_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"share_token" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"source_note_path" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'unlisted' NOT NULL,
	"current_revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "shared_documents_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
ALTER TABLE "shared_document_assets" ADD CONSTRAINT "shared_document_assets_shared_document_id_shared_documents_id_fk" FOREIGN KEY ("shared_document_id") REFERENCES "public"."shared_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_document_assets" ADD CONSTRAINT "shared_document_assets_shared_document_revision_id_shared_document_revisions_id_fk" FOREIGN KEY ("shared_document_revision_id") REFERENCES "public"."shared_document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_document_revisions" ADD CONSTRAINT "shared_document_revisions_shared_document_id_shared_documents_id_fk" FOREIGN KEY ("shared_document_id") REFERENCES "public"."shared_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_documents" ADD CONSTRAINT "shared_documents_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_document_assets_document_id_idx" ON "shared_document_assets" USING btree ("shared_document_id");--> statement-breakpoint
CREATE INDEX "shared_document_assets_revision_id_idx" ON "shared_document_assets" USING btree ("shared_document_revision_id");--> statement-breakpoint
CREATE INDEX "shared_document_revisions_document_id_idx" ON "shared_document_revisions" USING btree ("shared_document_id");--> statement-breakpoint
CREATE INDEX "shared_documents_owner_user_id_idx" ON "shared_documents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "shared_documents_source_note_path_idx" ON "shared_documents" USING btree ("source_note_path");