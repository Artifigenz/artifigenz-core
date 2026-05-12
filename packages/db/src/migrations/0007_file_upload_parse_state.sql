ALTER TABLE "file_uploads" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD COLUMN "parse_state" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD COLUMN "parse_error" text;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD COLUMN "institution_name" varchar(100);--> statement-breakpoint
ALTER TABLE "file_uploads" ADD COLUMN "account_last4" varchar(4);--> statement-breakpoint
ALTER TABLE "file_uploads" ADD COLUMN "account_type" varchar(20);--> statement-breakpoint
ALTER TABLE "file_uploads" ADD COLUMN "statement_period_start" date;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD COLUMN "statement_period_end" date;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE set null ON UPDATE no action;