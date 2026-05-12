ALTER TABLE "data_source_connections" ADD COLUMN "ingestion_state" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "ingestion_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "ingestion_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "last_sync_added_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "consecutive_empty_syncs" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "ingestion_in_flight" boolean DEFAULT false;