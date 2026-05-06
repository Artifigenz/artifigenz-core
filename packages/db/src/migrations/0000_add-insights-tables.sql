CREATE TABLE "agent_instance_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"skill_id" varchar(100) NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"state" jsonb DEFAULT '{}'::jsonb,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_type_id" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"goal" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"last_analyzed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_type_data_sources" (
	"agent_type_id" varchar(50) NOT NULL,
	"data_source_type_id" varchar(50) NOT NULL,
	CONSTRAINT "agent_type_data_sources_agent_type_id_data_source_type_id_pk" PRIMARY KEY("agent_type_id","data_source_type_id")
);
--> statement-breakpoint
CREATE TABLE "agent_types" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"is_active" boolean DEFAULT true,
	"config_schema" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "context_behavioral" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"active_hours" jsonb DEFAULT '[]'::jsonb,
	"insight_engagement" jsonb DEFAULT '{}'::jsonb,
	"dismissed_insight_types" text[] DEFAULT '{}',
	"notification_response" jsonb DEFAULT '{}'::jsonb,
	"last_active_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "context_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_type" varchar(50) NOT NULL,
	"fact_key" varchar(255) NOT NULL,
	"fact_value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "context_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"confidence" varchar(10) NOT NULL,
	"relevant_agents" text[] DEFAULT '{}',
	"source_data" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(20) DEFAULT 'active',
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "context_reasoner_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger_type" varchar(50) NOT NULL,
	"model_used" varchar(50),
	"input_tokens" integer,
	"output_tokens" integer,
	"observations_created" integer DEFAULT 0,
	"observations_expired" integer DEFAULT 0,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "context_stated" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"text" text NOT NULL,
	"related_to" text[] DEFAULT '{}',
	"source" varchar(20) NOT NULL,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"anchored_insight_id" uuid,
	"title" varchar(255),
	"message_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_source_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"data_source_type_id" varchar(50) NOT NULL,
	"display_name" varchar(255),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"credentials_encrypted" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_synced_at" timestamp with time zone,
	"sync_cursor" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_source_types" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"connection_flow" varchar(20) NOT NULL,
	"sync_mechanism" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"channel" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"attempt_count" integer DEFAULT 0,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "delivery_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT false,
	"email_address" varchar(255),
	"whatsapp_enabled" boolean DEFAULT false,
	"whatsapp_number" varchar(20),
	"whatsapp_opted_in" boolean DEFAULT false,
	"telegram_enabled" boolean DEFAULT false,
	"telegram_chat_id" varchar(50),
	"telegram_opted_in" boolean DEFAULT false,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "insight_types" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"skill_id" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_critical" boolean DEFAULT false,
	"delivery_channels" text[],
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"skill_id" varchar(100) NOT NULL,
	"insight_type_id" varchar(100) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"data" jsonb DEFAULT '{}'::jsonb,
	"is_critical" boolean DEFAULT false,
	"is_read" boolean DEFAULT false,
	"content_hash" varchar(64),
	"insight_date" date DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"token_count" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"agent_type_id" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"trigger_schedule" varchar(50),
	"trigger_events" text[],
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"avatar_url" text,
	"timezone" varchar(50),
	"locale" varchar(10),
	"currency" varchar(3),
	"onboarding_completed" boolean DEFAULT false,
	"chat_custom_instructions" text,
	"deletion_code" varchar(6),
	"deletion_code_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"last_active_at" timestamp with time zone,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_connection_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"file_size_bytes" integer,
	"extraction_status" varchar(20) DEFAULT 'pending',
	"extraction_result" jsonb,
	"transaction_count" integer,
	"uploaded_at" timestamp with time zone DEFAULT now(),
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"data_source_connection_id" uuid NOT NULL,
	"plaid_account_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"mask" varchar(10),
	"type" varchar(20),
	"subtype" varchar(30),
	"current_balance" numeric(14, 2),
	"available_balance" numeric(14, 2),
	"iso_currency_code" varchar(3),
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "finance_accounts_plaid_account_id_unique" UNIQUE("plaid_account_id")
);
--> statement-breakpoint
CREATE TABLE "finance_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"numbers" jsonb NOT NULL,
	"paragraph" text NOT NULL,
	"data_scope" text NOT NULL,
	"digest_snapshot" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"date" date NOT NULL,
	"skill" varchar(50) NOT NULL,
	"type" varchar(50) NOT NULL,
	"priority" varchar(10) NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_recurring_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"streams" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_recurring_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"plaid_stream_id" varchar(255) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"plaid_account_id" varchar(255),
	"merchant_name" varchar(255),
	"description" text,
	"average_amount" numeric(14, 2) NOT NULL,
	"frequency" varchar(30) NOT NULL,
	"last_date" date,
	"predicted_next_date" date,
	"first_date" date,
	"status" varchar(30) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "finance_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"merchant_name" varchar(255) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"frequency" varchar(20) NOT NULL,
	"last_charge_date" date,
	"next_charge_date" date,
	"charge_day" varchar(20),
	"account_name" varchar(100),
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "finance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_connection_id" uuid NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"transaction_date" date NOT NULL,
	"description" text NOT NULL,
	"merchant_name" varchar(255),
	"amount" numeric(12, 2) NOT NULL,
	"category" varchar(100),
	"account_name" varchar(100),
	"source" varchar(20) NOT NULL,
	"plaid_transaction_id" varchar(255),
	"plaid_account_id" varchar(255),
	"pending" integer DEFAULT 0,
	"pfc_primary" varchar(100),
	"pfc_detailed" varchar(100),
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "finance_transactions_plaid_transaction_id_unique" UNIQUE("plaid_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "health_daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"summary_date" date NOT NULL,
	"steps" integer,
	"sleep_minutes" integer,
	"resting_heart_rate" numeric(5, 1),
	"active_calories" integer,
	"exercise_minutes" integer,
	"weight" numeric(5, 1),
	"flights_climbed" integer,
	"distance_km" numeric(7, 2),
	"workout_count" integer,
	"workout_types" text[],
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "health_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_connection_id" uuid NOT NULL,
	"agent_instance_id" uuid NOT NULL,
	"metric_type" varchar(50) NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"unit" varchar(20) NOT NULL,
	"record_date" date NOT NULL,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"source" varchar(30) NOT NULL,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_instance_skills" ADD CONSTRAINT "agent_instance_skills_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_instance_skills" ADD CONSTRAINT "agent_instance_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_instances" ADD CONSTRAINT "agent_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_instances" ADD CONSTRAINT "agent_instances_agent_type_id_agent_types_id_fk" FOREIGN KEY ("agent_type_id") REFERENCES "public"."agent_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_type_data_sources" ADD CONSTRAINT "agent_type_data_sources_agent_type_id_agent_types_id_fk" FOREIGN KEY ("agent_type_id") REFERENCES "public"."agent_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_type_data_sources" ADD CONSTRAINT "agent_type_data_sources_data_source_type_id_data_source_types_id_fk" FOREIGN KEY ("data_source_type_id") REFERENCES "public"."data_source_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_behavioral" ADD CONSTRAINT "context_behavioral_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_observations" ADD CONSTRAINT "context_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_reasoner_runs" ADD CONSTRAINT "context_reasoner_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_stated" ADD CONSTRAINT "context_stated_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_anchored_insight_id_insights_id_fk" FOREIGN KEY ("anchored_insight_id") REFERENCES "public"."insights"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD CONSTRAINT "data_source_connections_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD CONSTRAINT "data_source_connections_data_source_type_id_data_source_types_id_fk" FOREIGN KEY ("data_source_type_id") REFERENCES "public"."data_source_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_log" ADD CONSTRAINT "delivery_log_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_preferences" ADD CONSTRAINT "delivery_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_types" ADD CONSTRAINT "insight_types_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_insight_type_id_insight_types_id_fk" FOREIGN KEY ("insight_type_id") REFERENCES "public"."insight_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_agent_type_id_agent_types_id_fk" FOREIGN KEY ("agent_type_id") REFERENCES "public"."agent_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_data_source_connection_id_data_source_connections_id_fk" FOREIGN KEY ("data_source_connection_id") REFERENCES "public"."data_source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_data_source_connection_id_data_source_connections_id_fk" FOREIGN KEY ("data_source_connection_id") REFERENCES "public"."data_source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_briefs" ADD CONSTRAINT "finance_briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_briefs" ADD CONSTRAINT "finance_briefs_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_insights" ADD CONSTRAINT "finance_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_insights" ADD CONSTRAINT "finance_insights_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_recurring_snapshots" ADD CONSTRAINT "finance_recurring_snapshots_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_recurring_streams" ADD CONSTRAINT "finance_recurring_streams_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_subscriptions" ADD CONSTRAINT "finance_subscriptions_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_data_source_connection_id_data_source_connections_id_fk" FOREIGN KEY ("data_source_connection_id") REFERENCES "public"."data_source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_daily_summaries" ADD CONSTRAINT "health_daily_summaries_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_metrics" ADD CONSTRAINT "health_metrics_data_source_connection_id_data_source_connections_id_fk" FOREIGN KEY ("data_source_connection_id") REFERENCES "public"."data_source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_metrics" ADD CONSTRAINT "health_metrics_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_instance_skills_unique" ON "agent_instance_skills" USING btree ("agent_instance_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_instances_user_type" ON "agent_instances" USING btree ("user_id","agent_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_context_facts_unique" ON "context_facts" USING btree ("user_id","agent_type","fact_key");--> statement-breakpoint
CREATE INDEX "idx_context_facts_user" ON "context_facts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_context_obs_active" ON "context_observations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_context_stated_user" ON "context_stated" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "idx_conversations_user_agent" ON "conversations" USING btree ("user_id","agent_instance_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_insights_user_feed" ON "insights" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_insights_unread" ON "insights" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_insights_dedup" ON "insights" USING btree ("agent_instance_id","skill_id","insight_type_id","insight_date","content_hash");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_users_clerk_id" ON "users" USING btree ("clerk_id");--> statement-breakpoint
CREATE INDEX "idx_finance_accounts_instance" ON "finance_accounts" USING btree ("agent_instance_id");--> statement-breakpoint
CREATE INDEX "idx_finance_briefs_user_latest" ON "finance_briefs" USING btree ("user_id","generated_at");--> statement-breakpoint
CREATE INDEX "idx_finance_briefs_instance_latest" ON "finance_briefs" USING btree ("agent_instance_id","generated_at");--> statement-breakpoint
CREATE INDEX "idx_finance_insights_user_date" ON "finance_insights" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_finance_insights_instance" ON "finance_insights" USING btree ("agent_instance_id","date");--> statement-breakpoint
CREATE INDEX "idx_finance_insights_skill" ON "finance_insights" USING btree ("skill","type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_recurring_snapshots_instance_date" ON "finance_recurring_snapshots" USING btree ("agent_instance_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_recurring_streams_instance_stream" ON "finance_recurring_streams" USING btree ("agent_instance_id","plaid_stream_id");--> statement-breakpoint
CREATE INDEX "idx_recurring_streams_dir" ON "finance_recurring_streams" USING btree ("agent_instance_id","direction");--> statement-breakpoint
CREATE INDEX "idx_finance_subs_next" ON "finance_subscriptions" USING btree ("next_charge_date");--> statement-breakpoint
CREATE INDEX "idx_finance_tx_agent_date" ON "finance_transactions" USING btree ("agent_instance_id","transaction_date");--> statement-breakpoint
CREATE INDEX "idx_finance_tx_merchant" ON "finance_transactions" USING btree ("agent_instance_id","merchant_name");--> statement-breakpoint
CREATE INDEX "idx_finance_tx_account" ON "finance_transactions" USING btree ("plaid_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_health_daily_unique" ON "health_daily_summaries" USING btree ("agent_instance_id","summary_date");--> statement-breakpoint
CREATE INDEX "idx_health_daily_agent_date" ON "health_daily_summaries" USING btree ("agent_instance_id","summary_date");--> statement-breakpoint
CREATE INDEX "idx_health_metrics_agent_date" ON "health_metrics" USING btree ("agent_instance_id","record_date");--> statement-breakpoint
CREATE INDEX "idx_health_metrics_type" ON "health_metrics" USING btree ("agent_instance_id","metric_type","record_date");