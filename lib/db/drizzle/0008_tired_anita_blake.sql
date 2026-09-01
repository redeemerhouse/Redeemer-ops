ALTER TABLE "applications" ADD CONSTRAINT "applications_preferred_house_id_houses_id_fk" FOREIGN KEY ("preferred_house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_converted_resident_id_residents_id_fk" FOREIGN KEY ("converted_resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_submissions" ADD CONSTRAINT "assessment_submissions_template_id_assessment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."assessment_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_submissions" ADD CONSTRAINT "assessment_submissions_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_history" ADD CONSTRAINT "document_history_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_import_rows" ADD CONSTRAINT "resident_import_rows_batch_id_resident_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."resident_import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_import_rows" ADD CONSTRAINT "resident_import_rows_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "residents_home_idx" ON "residents" USING btree ("home");--> statement-breakpoint
CREATE INDEX "residents_email_idx" ON "residents" USING btree ("email");--> statement-breakpoint
CREATE INDEX "payments_resident_due_date_idx" ON "payments" USING btree ("resident_id","due_date");--> statement-breakpoint
CREATE INDEX "payments_status_due_date_idx" ON "payments" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "applications_preferred_house_idx" ON "applications" USING btree ("preferred_house_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_converted_resident_unique" ON "applications" USING btree ("converted_resident_id");--> statement-breakpoint
CREATE INDEX "applications_status_created_at_idx" ON "applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "assessment_submissions_template_idx" ON "assessment_submissions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "assessment_submissions_resident_created_at_idx" ON "assessment_submissions" USING btree ("resident_id","created_at");--> statement-breakpoint
CREATE INDEX "document_history_document_created_at_idx" ON "document_history" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_resident_created_at_idx" ON "documents" USING btree ("resident_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_application_created_at_idx" ON "documents" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_object_path_idx" ON "documents" USING btree ("object_path");--> statement-breakpoint
CREATE INDEX "operations_resident_scheduled_date_idx" ON "operations" USING btree ("resident_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "resident_import_batches_status_created_at_idx" ON "resident_import_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resident_import_rows_batch_row_unique" ON "resident_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "resident_import_rows_resident_idx" ON "resident_import_rows" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "expenses_house_date_idx" ON "expenses" USING btree ("house_id","expense_date");--> statement-breakpoint
CREATE INDEX "income_records_house_date_idx" ON "income_records" USING btree ("house_id","received_date");--> statement-breakpoint
CREATE INDEX "meeting_attendance_house_date_idx" ON "meeting_attendance" USING btree ("house_id","meeting_date");--> statement-breakpoint
CREATE INDEX "auth_accounts_resident_idx" ON "auth_accounts" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "auth_action_tokens_account_idx" ON "auth_action_tokens" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK ((CASE WHEN "documents"."resident_id" IS NULL THEN 0 ELSE 1 END + CASE WHEN "documents"."application_id" IS NULL THEN 0 ELSE 1 END) = 1);