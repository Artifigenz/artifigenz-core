CREATE TABLE IF NOT EXISTS "shared_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "share_token" varchar(32) NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text,
  "messages_snapshot" jsonb NOT NULL,
  "show_owner_name" boolean DEFAULT true NOT NULL,
  "revoked_at" timestamp with time zone,
  "view_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_shared_conversations_token" ON "shared_conversations"("share_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shared_conversations_owner" ON "shared_conversations"("owner_user_id", "created_at" DESC);
