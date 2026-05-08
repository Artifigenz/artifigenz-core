CREATE TABLE "merchant_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_name_normalized" varchar(255) NOT NULL,
	"category" varchar(30) NOT NULL,
	"confidence" numeric(3, 2),
	"reasoning" text,
	"source" varchar(20) NOT NULL,
	"usage_count" integer DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "merchant_categories_merchant_name_normalized_unique" UNIQUE("merchant_name_normalized")
);
--> statement-breakpoint
ALTER TABLE "finance_recurring_streams" ADD COLUMN "category" varchar(30);--> statement-breakpoint
ALTER TABLE "finance_recurring_streams" ADD COLUMN "category_source" varchar(20);--> statement-breakpoint
ALTER TABLE "finance_recurring_streams" ADD COLUMN "category_confidence" numeric(3, 2);--> statement-breakpoint
CREATE INDEX "idx_merchant_categories_category" ON "merchant_categories" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_recurring_streams_category" ON "finance_recurring_streams" USING btree ("agent_instance_id","category");