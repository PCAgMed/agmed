CREATE TABLE "retention_run" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"table_name" text NOT NULL,
	"retention_class" text NOT NULL,
	"phase" text NOT NULL,
	"rows_affected" integer DEFAULT 0 NOT NULL,
	"actor" text NOT NULL,
	"error" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX "retention_run_run_idx" ON "retention_run" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "retention_run_table_idx" ON "retention_run" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "retention_run_class_idx" ON "retention_run" USING btree ("retention_class");--> statement-breakpoint
CREATE INDEX "retention_run_started_idx" ON "retention_run" USING btree ("started_at");