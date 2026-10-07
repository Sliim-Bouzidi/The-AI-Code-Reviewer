ALTER TABLE "llm_settings" ADD COLUMN "anthropic_api_key" text;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "openai_api_key" text;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "embedding_provider" text;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "openai_embedding_model" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "embedding_model" text;