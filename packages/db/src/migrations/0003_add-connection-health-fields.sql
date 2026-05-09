ALTER TABLE "data_source_connections" ADD COLUMN "last_sync_status" varchar(20);--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "requires_reauth" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "consecutive_failures" integer DEFAULT 0;