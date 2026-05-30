CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"subject_type" text,
	"subject_id" text,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"protocol" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"policy_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"source_ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_protocol_idx" ON "audit_log" USING btree ("protocol");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_subject_kind_uq" ON "consents" USING btree ("subject_type","subject_id","kind");--> statement-breakpoint
CREATE INDEX "consents_subject_idx" ON "consents" USING btree ("subject_type","subject_id");