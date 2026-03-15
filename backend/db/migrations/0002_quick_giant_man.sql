ALTER TABLE "shared_documents" ADD COLUMN "source_vault_path" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "shared_documents" ADD COLUMN "source_vault_name" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX "shared_documents_source_vault_path_idx" ON "shared_documents" USING btree ("source_vault_path");
--> statement-breakpoint
ALTER TABLE "shared_documents" ALTER COLUMN "source_vault_path" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "shared_documents" ALTER COLUMN "source_vault_name" DROP DEFAULT;
