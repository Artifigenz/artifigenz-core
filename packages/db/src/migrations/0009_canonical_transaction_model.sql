ALTER TABLE "messages" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "institution_id" varchar(100);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "source_transaction_id" varchar(255);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "posted_date" date;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "authorized_date" date;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "direction" varchar(3);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "normalized_description" text;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "account_type" varchar(20);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "account_mask" varchar(10);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "confidence" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "categorization_source" varchar(10);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "reasoning" text;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "needs_review" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ─── Backfill new columns for existing rows ───────────────────────

-- user_id ← agent_instances.user_id
UPDATE "finance_transactions" t
SET "user_id" = ai."user_id"
FROM "agent_instances" ai
WHERE t."agent_instance_id" = ai."id" AND t."user_id" IS NULL;--> statement-breakpoint

-- direction ← sign of amount. Sign convention: positive = OUT, negative = IN.
UPDATE "finance_transactions"
SET "direction" = CASE
  WHEN "amount" > 0 THEN 'out'
  WHEN "amount" < 0 THEN 'in'
END
WHERE "direction" IS NULL;--> statement-breakpoint

-- source: spec uses 'plaid' | 'statement' | 'manual'. Rename existing
-- 'upload' rows (our former value) to 'statement'.
UPDATE "finance_transactions" SET "source" = 'statement' WHERE "source" = 'upload';--> statement-breakpoint

-- source_transaction_id: mirror plaid_transaction_id for plaid rows.
UPDATE "finance_transactions"
SET "source_transaction_id" = "plaid_transaction_id"
WHERE "source" = 'plaid' AND "plaid_transaction_id" IS NOT NULL AND "source_transaction_id" IS NULL;--> statement-breakpoint

-- Denormalize account_type / account_mask / currency from finance_accounts.
UPDATE "finance_transactions" t
SET "account_type" = a."type",
    "account_mask" = a."account_last4",
    "currency" = a."iso_currency_code"
FROM "finance_accounts" a
WHERE t."account_id" = a."id" AND t."account_type" IS NULL;--> statement-breakpoint

-- normalized_description: cheap lowercase + whitespace-collapse for old rows.
-- The ingest pipeline writes a properly normalized value going forward.
UPDATE "finance_transactions"
SET "normalized_description" = regexp_replace(lower(trim("description")), '\s+', ' ', 'g')
WHERE "normalized_description" IS NULL;