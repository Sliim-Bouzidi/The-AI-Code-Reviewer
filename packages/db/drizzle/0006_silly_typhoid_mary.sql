ALTER TABLE "github_app" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "github_app" ADD CONSTRAINT "github_app_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD CONSTRAINT "llm_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The existing app's admin: the first user who connected it (single-tenant installs have only one).
UPDATE "github_app" SET "created_by" = (SELECT "user_id" FROM "installations" WHERE "user_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by" IS NULL;--> statement-breakpoint
-- The old shared settings row becomes the admin's own settings.
UPDATE "llm_settings" SET "user_id" = (SELECT "created_by" FROM "github_app" WHERE "id" = 'default') WHERE "user_id" IS NULL;
