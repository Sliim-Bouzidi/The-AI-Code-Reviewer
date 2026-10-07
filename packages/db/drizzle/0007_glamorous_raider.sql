DELETE FROM "llm_settings" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "llm_settings" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "llm_settings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD PRIMARY KEY ("user_id");
