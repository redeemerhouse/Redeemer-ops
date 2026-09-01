DROP INDEX "auth_sessions_account_idx";--> statement-breakpoint
CREATE INDEX "auth_sessions_account_idx" ON "auth_sessions" USING btree ("account_id");