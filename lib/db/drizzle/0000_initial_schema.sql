CREATE TABLE "residents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"home" text NOT NULL,
	"move_in_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"balance" numeric(10, 2) DEFAULT '0' NOT NULL,
	"next_payment_date" date NOT NULL,
	"notes" text,
	"family_status" text DEFAULT 'individual' NOT NULL,
	"lifecycle_state" text DEFAULT 'applicant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"resident_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"due_date" date NOT NULL,
	"paid_date" date,
	"status" text DEFAULT 'due' NOT NULL,
	"method" text
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"applicant_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"preferred_house_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"family_information" jsonb,
	"referral_history" text,
	"treatment_history" text,
	"spiritual_reflection" text,
	"signed_acknowledgment" boolean DEFAULT false NOT NULL,
	"checklist" jsonb,
	"exception_reason" text,
	"converted_resident_id" integer,
	"source" text DEFAULT 'direct' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"actor" text DEFAULT 'system' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"action" text NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"from_visibility" text,
	"to_visibility" text,
	"object_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"resident_id" integer,
	"application_id" integer,
	"object_path" text,
	"file_name" text,
	"content_type" text,
	"file_size" integer,
	"visibility" text DEFAULT 'staff' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"uploaded_by" text,
	"shared_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "houses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"manager_name" text,
	"family_capacity" integer DEFAULT 0 NOT NULL,
	"individual_weekly" numeric(10, 2) DEFAULT '175' NOT NULL,
	"family_weekly" numeric(10, 2) DEFAULT '200' NOT NULL,
	"individual_monthly" numeric(10, 2) DEFAULT '700' NOT NULL,
	"family_monthly" numeric(10, 2) DEFAULT '800' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"resident_id" integer,
	"scheduled_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;