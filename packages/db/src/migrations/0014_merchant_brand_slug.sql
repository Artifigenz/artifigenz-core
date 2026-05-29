ALTER TABLE "merchant_brands" ADD COLUMN "brand_slug" varchar(64);--> statement-breakpoint
CREATE INDEX "idx_merchant_brands_slug" ON "merchant_brands" USING btree ("brand_slug");