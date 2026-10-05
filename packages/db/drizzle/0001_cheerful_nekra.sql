CREATE TABLE "github_app" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"app_id" bigint NOT NULL,
	"slug" text NOT NULL,
	"private_key" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"html_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "check_run_id" bigint;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_events_review_created" ON "review_events" USING btree ("review_id","created_at");