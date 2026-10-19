CREATE TABLE IF NOT EXISTS "llm_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"data" jsonb NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_cache_created" ON "llm_cache" USING btree ("created_at");