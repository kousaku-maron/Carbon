CREATE TABLE "note_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"last_content_hash" text NOT NULL,
	"last_repo_commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"base_path" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"event_type" text NOT NULL,
	"note_id" uuid,
	"file_path" text,
	"commit_sha" text,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_sync_state" ADD CONSTRAINT "note_sync_state_connection_id_sync_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sync_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_sync_state" ADD CONSTRAINT "note_sync_state_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_connections" ADD CONSTRAINT "sync_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_connection_id_sync_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sync_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_sync_conn_idx" ON "note_sync_state" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_sync_conn_note_idx" ON "note_sync_state" USING btree ("connection_id","note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_sync_conn_path_idx" ON "note_sync_state" USING btree ("connection_id","file_path");--> statement-breakpoint
CREATE INDEX "sync_conn_user_idx" ON "sync_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_conn_user_repo_idx" ON "sync_connections" USING btree ("user_id","repo_owner","repo_name");--> statement-breakpoint
CREATE INDEX "sync_events_conn_idx" ON "sync_events" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "sync_events_created_idx" ON "sync_events" USING btree ("connection_id","created_at");