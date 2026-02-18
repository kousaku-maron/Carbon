ALTER TABLE "note_sync_state" DROP CONSTRAINT "note_sync_state_note_id_notes_id_fk";
--> statement-breakpoint
ALTER TABLE "note_sync_state" ALTER COLUMN "note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "note_sync_state" ADD COLUMN "last_synced_note_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "note_sync_state" ADD COLUMN "last_file_sha" text;--> statement-breakpoint
ALTER TABLE "note_sync_state" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "note_sync_state" ADD CONSTRAINT "note_sync_state_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;