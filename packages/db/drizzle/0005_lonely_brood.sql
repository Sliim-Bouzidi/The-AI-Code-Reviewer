CREATE TABLE "eval_case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_name" text NOT NULL,
	"description" text,
	"expected" integer NOT NULL,
	"caught" integer NOT NULL,
	"findings" integer NOT NULL,
	"on_target" integer NOT NULL,
	"false_alarms" integer NOT NULL,
	"missed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_id" uuid,
	"duration_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"provider" text,
	"model" text,
	"cases_total" integer,
	"cases_done" integer DEFAULT 0 NOT NULL,
	"expected" integer DEFAULT 0 NOT NULL,
	"caught" integer DEFAULT 0 NOT NULL,
	"findings" integer DEFAULT 0 NOT NULL,
	"on_target" integer DEFAULT 0 NOT NULL,
	"false_alarms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_case_results_run" ON "eval_case_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_runs_user_created" ON "eval_runs" USING btree ("user_id","created_at");