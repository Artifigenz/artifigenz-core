CREATE TABLE "merchant_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"merchant_normalized" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"category" varchar(30) NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"cadence" varchar(20),
	"monthly_amount" numeric(14, 2),
	"txn_count" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"first_seen_date" date,
	"last_seen_date" date,
	"confidence" numeric(3, 2),
	"reasoning" text,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_accounts" DROP CONSTRAINT "finance_accounts_data_source_connection_id_data_source_connections_id_fk";
--> statement-breakpoint
ALTER TABLE "finance_transactions" DROP CONSTRAINT "finance_transactions_data_source_connection_id_data_source_connections_id_fk";
--> statement-breakpoint
ALTER TABLE "finance_accounts" ALTER COLUMN "data_source_connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_accounts" ALTER COLUMN "plaid_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_transactions" ALTER COLUMN "data_source_connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_transactions" ALTER COLUMN "category" SET DATA TYPE varchar(30);--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD COLUMN "institution_name" varchar(100);--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD COLUMN "account_last4" varchar(4);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "merchant_normalized" varchar(255);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "description_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "is_recurring" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "merchant_cluster_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_clusters" ADD CONSTRAINT "merchant_clusters_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_merchant_clusters_unique" ON "merchant_clusters" USING btree ("agent_instance_id","merchant_normalized");--> statement-breakpoint
CREATE INDEX "idx_merchant_clusters_category" ON "merchant_clusters" USING btree ("agent_instance_id","category");--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_data_source_connection_id_data_source_connections_id_fk" FOREIGN KEY ("data_source_connection_id") REFERENCES "public"."data_source_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_merchant_cluster_id_merchant_clusters_id_fk" FOREIGN KEY ("merchant_cluster_id") REFERENCES "public"."merchant_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_data_source_connection_id_data_source_connections_id_fk" FOREIGN KEY ("data_source_connection_id") REFERENCES "public"."data_source_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_finance_accounts_identity" ON "finance_accounts" USING btree ("agent_instance_id","institution_name","account_last4");--> statement-breakpoint
CREATE INDEX "idx_finance_tx_account_id" ON "finance_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_finance_tx_cluster" ON "finance_transactions" USING btree ("merchant_cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_finance_tx_dedup" ON "finance_transactions" USING btree ("account_id","transaction_date","amount","description_hash");