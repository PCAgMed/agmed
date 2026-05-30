CREATE TABLE "clinic_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"clinic_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "clinic_memberships_role_chk" CHECK (role IN ('owner','admin','receptionist','doctor')),
	CONSTRAINT "clinic_memberships_status_chk" CHECK (status IN ('active','suspended','revoked'))
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cnpj" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "clinics_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "clinic_id" uuid;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "clinic_id" uuid;--> statement-breakpoint
ALTER TABLE "clinic_memberships" ADD CONSTRAINT "clinic_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_memberships" ADD CONSTRAINT "clinic_memberships_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_memberships_user_clinic_uq" ON "clinic_memberships" USING btree ("user_id","clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_memberships_revalidation_idx" ON "clinic_memberships" USING btree ("user_id","clinic_id","status");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_clinic_idx" ON "audit_log" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "consents_clinic_idx" ON "consents" USING btree ("clinic_id");