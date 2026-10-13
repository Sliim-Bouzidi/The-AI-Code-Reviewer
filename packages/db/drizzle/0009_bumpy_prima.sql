CREATE TABLE "code_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"branch" text NOT NULL,
	"status" text NOT NULL,
	"commit_sha" text,
	"progress" text,
	"files_count" integer DEFAULT 0 NOT NULL,
	"symbols_count" integer DEFAULT 0 NOT NULL,
	"relations_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_analyses_repo_branch" UNIQUE("repo_id","branch")
);
--> statement-breakpoint
CREATE TABLE "code_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"path" text NOT NULL,
	"language" text,
	"lines" integer DEFAULT 0 NOT NULL,
	"package_name" text
);
--> statement-breakpoint
CREATE TABLE "code_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_file" text NOT NULL,
	"from_symbol" text,
	"to_file" text,
	"to_symbol" text,
	"to_external" text,
	"confidence" text NOT NULL,
	"line" integer
);
--> statement-breakpoint
CREATE TABLE "code_symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"container" text,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_analyses" ADD CONSTRAINT "code_analyses_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_files" ADD CONSTRAINT "code_files_analysis_id_code_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."code_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_relations" ADD CONSTRAINT "code_relations_analysis_id_code_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."code_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_analysis_id_code_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."code_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_files_analysis_path" ON "code_files" USING btree ("analysis_id","path");--> statement-breakpoint
CREATE INDEX "code_relations_analysis_kind" ON "code_relations" USING btree ("analysis_id","kind");--> statement-breakpoint
CREATE INDEX "code_symbols_analysis_file" ON "code_symbols" USING btree ("analysis_id","file_path");