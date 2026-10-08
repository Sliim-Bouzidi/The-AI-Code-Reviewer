CREATE TABLE "test_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"head_sha" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"coverage_before" integer,
	"coverage_after" integer,
	"coverage_gain" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"source_file" text NOT NULL,
	"class_name" text NOT NULL,
	"method_name" text NOT NULL,
	"test_class_name" text NOT NULL,
	"test_code" text NOT NULL,
	"raw_llm_output" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"compile_success" boolean,
	"compile_error" text,
	"test_success" boolean,
	"execution_output" text,
	"execution_error" text,
	"duration_ms" integer,
	"posted_to_github" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_generations" ADD CONSTRAINT "test_generations_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_generations" ADD CONSTRAINT "test_generations_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_tests" ADD CONSTRAINT "generated_tests_generation_id_test_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."test_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_generations_pr" ON "test_generations" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "test_generations_repo_created" ON "test_generations" USING btree ("repo_id","created_at");--> statement-breakpoint
CREATE INDEX "generated_tests_generation" ON "generated_tests" USING btree ("generation_id");
