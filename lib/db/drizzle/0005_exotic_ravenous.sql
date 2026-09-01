CREATE TABLE "auth_account_houses" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"house_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"organization_id" text DEFAULT 'redeemer-house' NOT NULL,
	"role" text DEFAULT 'resident' NOT NULL,
	"resident_id" integer,
	"email_verified_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_role_allowed" CHECK ("auth_accounts"."role" IN ('owner_admin', 'program_director', 'house_manager', 'resident'))
);
--> statement-breakpoint
CREATE TABLE "auth_action_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"type" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_action_tokens_type_allowed" CHECK ("auth_action_tokens"."type" IN ('email_verification', 'password_reset'))
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "auth_account_houses" ADD CONSTRAINT "auth_account_houses_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account_houses" ADD CONSTRAINT "auth_account_houses_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_action_tokens" ADD CONSTRAINT "auth_action_tokens_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_houses_account_house_unique" ON "auth_account_houses" USING btree ("account_id","house_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_email_unique" ON "auth_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_action_tokens_hash_unique" ON "auth_action_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_account_idx" ON "auth_sessions" USING btree ("account_id");