CREATE TABLE "merchant_brands" (
	"merchant_normalized" varchar(255) PRIMARY KEY NOT NULL,
	"display_name" varchar(255),
	"logo_url" text,
	"website" varchar(255),
	"brand_color" varchar(7),
	"industry" varchar(60),
	"source" varchar(16) NOT NULL,
	"confidence" numeric(3, 2),
	"raw_data" jsonb,
	"last_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_merchant_brands_source" ON "merchant_brands" USING btree ("source");