ALTER TABLE "auth_accounts" DROP CONSTRAINT "auth_accounts_role_allowed";--> statement-breakpoint
ALTER TABLE "auth_accounts" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "auth_accounts" ALTER COLUMN "role" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "first_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "account_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
DELETE FROM "auth_account_houses"
WHERE "account_id" IN (
  SELECT "id" FROM "auth_accounts"
  WHERE "approved_at" IS NULL
);--> statement-breakpoint
UPDATE "auth_accounts"
SET
  "account_status" = CASE
    WHEN "approved_at" IS NULL THEN 'pending'
    WHEN "deactivated_at" IS NOT NULL THEN 'disabled'
    ELSE 'active'
  END,
  "role" = CASE
    WHEN "approved_at" IS NULL THEN NULL
    ELSE "role"
  END,
  "resident_id" = CASE
    WHEN "approved_at" IS NULL THEN NULL
    ELSE "resident_id"
  END,
  "first_name" = CASE
    WHEN btrim("first_name") = '' THEN split_part("email", '@', 1)
    ELSE "first_name"
  END;--> statement-breakpoint
CREATE INDEX "auth_accounts_status_idx" ON "auth_accounts" USING btree ("account_status");--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_status_allowed" CHECK ("auth_accounts"."account_status" IN ('pending', 'active', 'suspended', 'disabled'));--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_pending_unassigned" CHECK (("auth_accounts"."account_status" <> 'pending' OR ("auth_accounts"."role" IS NULL AND "auth_accounts"."resident_id" IS NULL)));--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_role_allowed" CHECK ("auth_accounts"."role" IS NULL OR "auth_accounts"."role" IN ('owner_admin', 'program_director', 'house_manager', 'resident'));