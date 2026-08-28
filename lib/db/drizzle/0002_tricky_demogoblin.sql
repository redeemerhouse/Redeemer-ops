CREATE TABLE "resident_import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_filename" text NOT NULL,
	"actor" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"total_rows" integer NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resident_import_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"source_data" jsonb NOT NULL,
	"normalized_data" jsonb,
	"outcome" text DEFAULT 'failed' NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resident_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
