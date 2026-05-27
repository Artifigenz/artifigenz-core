ALTER TABLE "conversations" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_preferences" ADD COLUMN "telegram_link_token" varchar(64);--> statement-breakpoint
ALTER TABLE "delivery_preferences" ADD COLUMN "telegram_link_token_expires_at" timestamp with time zone;