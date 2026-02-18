ALTER TABLE "posts" RENAME TO "notes";--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT "posts_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "posts_created_at_idx";--> statement-breakpoint
DROP INDEX "posts_user_created_at_idx";--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_created_at_idx" ON "notes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notes_user_created_at_idx" ON "notes" USING btree ("user_id","created_at");