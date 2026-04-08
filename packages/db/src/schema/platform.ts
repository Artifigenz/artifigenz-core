import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  date,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Users (synced from Clerk via webhooks) ─────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkId: varchar("clerk_id", { length: 255 }).unique().notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    avatarUrl: text("avatar_url"),
    timezone: varchar("timezone", { length: 50 }).default("UTC"),
    locale: varchar("locale", { length: 10 }).default("en-US"),
    currency: varchar("currency", { length: 3 }).default("USD"),
    onboardingCompleted: boolean("onboarding_completed").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (table) => [index("idx_users_clerk_id").on(table.clerkId)],
);

// ─── Agent Type Catalog ─────────────────────────────────────────────

export const agentTypes = pgTable("agent_types", {
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }),
  isActive: boolean("is_active").default(true),
  configSchema: jsonb("config_schema"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Agent Instances (one per user per agent type) ──────────────────

export const agentInstances = pgTable(
  "agent_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentTypeId: varchar("agent_type_id", { length: 50 })
      .notNull()
      .references(() => agentTypes.id),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    goal: text("goal"),
    config: jsonb("config").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastAnalyzedAt: timestamp("last_analyzed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_agent_instances_user_type").on(
      table.userId,
      table.agentTypeId,
    ),
  ],
);

// ─── Skills Catalog ─────────────────────────────────────────────────

export const skills = pgTable("skills", {
  id: varchar("id", { length: 100 }).primaryKey(),
  agentTypeId: varchar("agent_type_id", { length: 50 })
    .notNull()
    .references(() => agentTypes.id),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  triggerSchedule: varchar("trigger_schedule", { length: 50 }),
  triggerEvents: text("trigger_events").array(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Active Skills per Agent Instance ───────────────────────────────

export const agentInstanceSkills = pgTable(
  "agent_instance_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    skillId: varchar("skill_id", { length: 100 })
      .notNull()
      .references(() => skills.id),
    isEnabled: boolean("is_enabled").default(true),
    state: jsonb("state").default({}),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_agent_instance_skills_unique").on(
      table.agentInstanceId,
      table.skillId,
    ),
  ],
);

// ─── Data Source Type Catalog ───────────────────────────────────────

export const dataSourceTypes = pgTable("data_source_types", {
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  connectionFlow: varchar("connection_flow", { length: 20 }).notNull(),
  syncMechanism: varchar("sync_mechanism", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Agent Type <-> Data Source Type (many-to-many) ─────────────────

export const agentTypeDataSources = pgTable(
  "agent_type_data_sources",
  {
    agentTypeId: varchar("agent_type_id", { length: 50 })
      .notNull()
      .references(() => agentTypes.id),
    dataSourceTypeId: varchar("data_source_type_id", { length: 50 })
      .notNull()
      .references(() => dataSourceTypes.id),
  },
  (table) => [
    primaryKey({ columns: [table.agentTypeId, table.dataSourceTypeId] }),
  ],
);

// ─── User Data Source Connections ───────────────────────────────────

export const dataSourceConnections = pgTable("data_source_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentInstanceId: uuid("agent_instance_id")
    .notNull()
    .references(() => agentInstances.id, { onDelete: "cascade" }),
  dataSourceTypeId: varchar("data_source_type_id", { length: 50 })
    .notNull()
    .references(() => dataSourceTypes.id),
  displayName: varchar("display_name", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  credentialsEncrypted: jsonb("credentials_encrypted"),
  metadata: jsonb("metadata").default({}),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  syncCursor: varchar("sync_cursor", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Insight Types Catalog ──────────────────────────────────────────

export const insightTypes = pgTable("insight_types", {
  id: varchar("id", { length: 100 }).primaryKey(),
  skillId: varchar("skill_id", { length: 100 })
    .notNull()
    .references(() => skills.id),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  isCritical: boolean("is_critical").default(false),
  deliveryChannels: text("delivery_channels").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Insights (the unified feed) ───────────────────────────────────

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    skillId: varchar("skill_id", { length: 100 })
      .notNull()
      .references(() => skills.id),
    insightTypeId: varchar("insight_type_id", { length: 100 })
      .notNull()
      .references(() => insightTypes.id),
    title: text("title").notNull(),
    description: text("description"),
    data: jsonb("data").default({}),
    isCritical: boolean("is_critical").default(false),
    isRead: boolean("is_read").default(false),
    contentHash: varchar("content_hash", { length: 64 }),
    insightDate: date("insight_date").defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_insights_user_feed").on(table.userId, table.createdAt),
    index("idx_insights_unread").on(table.userId, table.isRead),
    uniqueIndex("idx_insights_dedup").on(
      table.agentInstanceId,
      table.skillId,
      table.insightTypeId,
      table.insightDate,
      table.contentHash,
    ),
  ],
);

// ─── Delivery Preferences ──────────────────────────────────────────

export const deliveryPreferences = pgTable("delivery_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  emailEnabled: boolean("email_enabled").default(false),
  emailAddress: varchar("email_address", { length: 255 }),
  whatsappEnabled: boolean("whatsapp_enabled").default(false),
  whatsappNumber: varchar("whatsapp_number", { length: 20 }),
  whatsappOptedIn: boolean("whatsapp_opted_in").default(false),
  telegramEnabled: boolean("telegram_enabled").default(false),
  telegramChatId: varchar("telegram_chat_id", { length: 50 }),
  telegramOptedIn: boolean("telegram_opted_in").default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Delivery Log ──────────────────────────────────────────────────

export const deliveryLog = pgTable("delivery_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  insightId: uuid("insight_id")
    .notNull()
    .references(() => insights.id),
  channel: varchar("channel", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  attemptCount: integer("attempt_count").default(0),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Unified Context: Layer A — Structured Facts ───────────────────

export const contextFacts = pgTable(
  "context_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentType: varchar("agent_type", { length: 50 }).notNull(),
    factKey: varchar("fact_key", { length: 255 }).notNull(),
    factValue: jsonb("fact_value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_context_facts_unique").on(
      table.userId,
      table.agentType,
      table.factKey,
    ),
    index("idx_context_facts_user").on(table.userId),
  ],
);

// ─── Unified Context: Layer B — Inferred Observations ──────────────

export const contextObservations = pgTable(
  "context_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    confidence: varchar("confidence", { length: 10 }).notNull(),
    relevantAgents: text("relevant_agents").array().default([]),
    sourceData: jsonb("source_data").default([]),
    status: varchar("status", { length: 20 }).default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_context_obs_active").on(table.userId, table.status),
  ],
);

// ─── Unified Context: Layer C — User-Stated Context ────────────────

export const contextStated = pgTable(
  "context_stated",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull(),
    text: text("text").notNull(),
    relatedTo: text("related_to").array().default([]),
    source: varchar("source", { length: 20 }).notNull(),
    active: boolean("active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_context_stated_user").on(table.userId, table.active),
  ],
);

// ─── Unified Context: Layer D — Behavioral Patterns ────────────────

export const contextBehavioral = pgTable("context_behavioral", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  activeHours: jsonb("active_hours").default([]),
  insightEngagement: jsonb("insight_engagement").default({}),
  dismissedInsightTypes: text("dismissed_insight_types").array().default([]),
  notificationResponse: jsonb("notification_response").default({}),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Context Reasoner Audit Log ────────────────────────────────────

export const contextReasonerRuns = pgTable("context_reasoner_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  triggerType: varchar("trigger_type", { length: 50 }).notNull(),
  modelUsed: varchar("model_used", { length: 50 }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  observationsCreated: integer("observations_created").default(0),
  observationsExpired: integer("observations_expired").default(0),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Conversations (chat) ──────────────────────────────────────────

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    anchoredInsightId: uuid("anchored_insight_id").references(
      () => insights.id,
      { onDelete: "set null" },
    ),
    title: varchar("title", { length: 255 }),
    messageCount: integer("message_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_conversations_user_agent").on(
      table.userId,
      table.agentInstanceId,
      table.updatedAt,
    ),
  ],
);

// ─── Messages (chat) ───────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_messages_conversation").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);
