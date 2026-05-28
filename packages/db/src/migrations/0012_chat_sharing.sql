CREATE TABLE "shared_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_token" varchar(32) NOT NULL,
	"conversation_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text,
	"messages_snapshot" jsonb NOT NULL,
	"show_owner_name" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_conversations" ADD CONSTRAINT "shared_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_conversations" ADD CONSTRAINT "shared_conversations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shared_conversations_token" ON "shared_conversations" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "idx_shared_conversations_owner" ON "shared_conversations" USING btree ("owner_user_id","created_at");