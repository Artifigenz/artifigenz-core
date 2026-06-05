CREATE TABLE "user_brand_categories" (
	"agent_instance_id" uuid NOT NULL,
	"brand_slug" varchar(64) NOT NULL,
	"category" varchar(30) NOT NULL,
	"system_category" varchar(40),
	"confidence" numeric(3, 2),
	"source" varchar(20) NOT NULL,
	"reasoning" text,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "transfer_pair_id" uuid;--> statement-breakpoint
ALTER TABLE "user_brand_categories" ADD CONSTRAINT "user_brand_categories_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_brand_categories_pk" ON "user_brand_categories" USING btree ("agent_instance_id","brand_slug");--> statement-breakpoint
CREATE INDEX "idx_user_brand_categories_cat" ON "user_brand_categories" USING btree ("agent_instance_id","category");--> statement-breakpoint
CREATE INDEX "idx_finance_tx_transfer_pair" ON "finance_transactions" USING btree ("transfer_pair_id");