CREATE TABLE "llm_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"gemini_api_key" text,
	"openrouter_api_key" text,
	"openai_compat_base_url" text,
	"openai_compat_api_key" text,
	"llm_provider" text,
	"llm_model" text,
	"llm_fallback_provider" text,
	"llm_fallback_model" text,
	"embedding_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
