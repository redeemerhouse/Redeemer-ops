CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"expense_date" date NOT NULL,
	"category" text NOT NULL,
	"house_id" integer,
	"description" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_non_negative" CHECK ("expenses"."amount" >= 0),
	CONSTRAINT "expenses_amount_maximum" CHECK ("expenses"."amount" <= 99999999.99),
	CONSTRAINT "expenses_category_allowed" CHECK ("expenses"."category" IN ('housing', 'utilities', 'food', 'transportation', 'programming', 'payroll', 'other'))
);
--> statement-breakpoint
CREATE TABLE "income_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"received_date" date NOT NULL,
	"category" text NOT NULL,
	"house_id" integer,
	"description" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "income_records_amount_non_negative" CHECK ("income_records"."amount" >= 0),
	CONSTRAINT "income_records_amount_maximum" CHECK ("income_records"."amount" <= 99999999.99),
	CONSTRAINT "income_records_category_allowed" CHECK ("income_records"."category" IN ('admission_fee', 'program_fee', 'grant', 'other'))
);
--> statement-breakpoint
CREATE TABLE "meeting_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_type" text NOT NULL,
	"meeting_date" date NOT NULL,
	"house_id" integer,
	"women_attended" integer NOT NULL,
	"women_eligible" integer NOT NULL,
	"notes" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_attendance_type_allowed" CHECK ("meeting_attendance"."meeting_type" IN ('recovery_meeting', 'house_meeting', 'life_skills', 'case_management', 'other')),
	CONSTRAINT "meeting_attendance_women_attended_non_negative" CHECK ("meeting_attendance"."women_attended" >= 0),
	CONSTRAINT "meeting_attendance_women_eligible_non_negative" CHECK ("meeting_attendance"."women_eligible" >= 0),
	CONSTRAINT "meeting_attendance_attended_within_eligible" CHECK ("meeting_attendance"."women_attended" <= "meeting_attendance"."women_eligible")
);
--> statement-breakpoint
CREATE TABLE "deletion_quarantines" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"scope" jsonb NOT NULL,
	"reason" text NOT NULL,
	"authorized_by" text NOT NULL,
	"authorized_role" text NOT NULL,
	"status" text DEFAULT 'quarantined' NOT NULL,
	"archive" jsonb NOT NULL,
	"quarantined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"eligible_at" timestamp with time zone NOT NULL,
	"canceled_at" timestamp with time zone,
	"canceled_by" text,
	"cancellation_reason" text,
	"purged_at" timestamp with time zone,
	CONSTRAINT "deletion_quarantines_target_type_check" CHECK ("deletion_quarantines"."target_type" in ('resident', 'application', 'document', 'operation', 'payment')),
	CONSTRAINT "deletion_quarantines_target_id_check" CHECK ("deletion_quarantines"."target_id" > 0),
	CONSTRAINT "deletion_quarantines_status_check" CHECK ("deletion_quarantines"."status" in ('quarantined', 'purging', 'canceled', 'purged')),
	CONSTRAINT "deletion_quarantines_cancellation_fields_check" CHECK (("deletion_quarantines"."status" in ('quarantined', 'purging') and "deletion_quarantines"."canceled_at" is null and "deletion_quarantines"."canceled_by" is null and "deletion_quarantines"."cancellation_reason" is null)
        or ("deletion_quarantines"."status" = 'canceled' and "deletion_quarantines"."canceled_at" is not null and "deletion_quarantines"."canceled_by" is not null and "deletion_quarantines"."cancellation_reason" is not null)
        or ("deletion_quarantines"."status" = 'purged' and "deletion_quarantines"."canceled_at" is null and "deletion_quarantines"."canceled_by" is null and "deletion_quarantines"."cancellation_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"scope" jsonb NOT NULL,
	"reason" text NOT NULL,
	"placed_by" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" text,
	"release_reason" text,
	CONSTRAINT "legal_holds_target_type_check" CHECK ("legal_holds"."target_type" in ('resident', 'application', 'document', 'operation', 'payment')),
	CONSTRAINT "legal_holds_target_id_check" CHECK ("legal_holds"."target_id" > 0),
	CONSTRAINT "legal_holds_status_check" CHECK ("legal_holds"."status" in ('active', 'released')),
	CONSTRAINT "legal_holds_release_fields_check" CHECK (("legal_holds"."status" = 'active' and "legal_holds"."released_at" is null and "legal_holds"."released_by" is null and "legal_holds"."release_reason" is null)
        or ("legal_holds"."status" = 'released' and "legal_holds"."released_at" is not null and "legal_holds"."released_by" is not null and "legal_holds"."release_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "outcome" text DEFAULT 'success' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "retention_until" timestamp with time zone DEFAULT CURRENT_TIMESTAMP + interval '7 years' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_records" ADD CONSTRAINT "income_records_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_quarantines_active_target_idx" ON "deletion_quarantines" USING btree ("target_type","target_id") WHERE "deletion_quarantines"."status" = 'quarantined';--> statement-breakpoint
CREATE INDEX "deletion_quarantines_due_idx" ON "deletion_quarantines" USING btree ("status","eligible_at");--> statement-breakpoint
CREATE INDEX "deletion_quarantines_target_idx" ON "deletion_quarantines" USING btree ("organization_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "legal_holds_target_status_idx" ON "legal_holds" USING btree ("organization_id","target_type","target_id","status");--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_status_allowed" CHECK ("residents"."status" IN ('active', 'pending', 'exited'));--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_balance_non_negative" CHECK ("residents"."balance" >= 0);--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_balance_maximum" CHECK ("residents"."balance" <= 99999999.99);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_non_negative" CHECK ("payments"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_maximum" CHECK ("payments"."amount" <= 99999999.99);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_allowed" CHECK ("payments"."status" IN ('paid', 'due', 'overdue'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_matches_paid_date" CHECK (("payments"."status" = 'paid') = ("payments"."paid_date" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_length" CHECK ("payments"."method" IS NULL OR char_length("payments"."method") <= 80);