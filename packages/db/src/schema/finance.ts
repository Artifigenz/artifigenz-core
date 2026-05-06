import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  decimal,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agentInstances, dataSourceConnections, users } from "./platform";

// ─── Normalized Transactions ───────────────────────────────────────

export const financeTransactions = pgTable(
  "finance_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceConnectionId: uuid("data_source_connection_id")
      .notNull()
      .references(() => dataSourceConnections.id, { onDelete: "cascade" }),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    transactionDate: date("transaction_date").notNull(),
    description: text("description").notNull(),
    merchantName: varchar("merchant_name", { length: 255 }),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    category: varchar("category", { length: 100 }),
    accountName: varchar("account_name", { length: 100 }),
    source: varchar("source", { length: 20 }).notNull(),
    plaidTransactionId: varchar("plaid_transaction_id", { length: 255 }).unique(),
    // Plaid account_id — lets the Brief algorithm join a transaction to its account
    // type (depository vs credit) without parsing rawData.
    plaidAccountId: varchar("plaid_account_id", { length: 255 }),
    pending: integer("pending").default(0),
    personalFinanceCategoryPrimary: varchar("pfc_primary", { length: 100 }),
    personalFinanceCategoryDetailed: varchar("pfc_detailed", { length: 100 }),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_finance_tx_agent_date").on(
      table.agentInstanceId,
      table.transactionDate,
    ),
    index("idx_finance_tx_merchant").on(
      table.agentInstanceId,
      table.merchantName,
    ),
    index("idx_finance_tx_account").on(table.plaidAccountId),
  ],
);

// ─── Detected Subscriptions ────────────────────────────────────────

export const financeSubscriptions = pgTable(
  "finance_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    merchantName: varchar("merchant_name", { length: 255 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    frequency: varchar("frequency", { length: 20 }).notNull(),
    lastChargeDate: date("last_charge_date"),
    nextChargeDate: date("next_charge_date"),
    chargeDay: varchar("charge_day", { length: 20 }),
    accountName: varchar("account_name", { length: 100 }),
    status: varchar("status", { length: 20 }).default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_finance_subs_next").on(table.nextChargeDate),
  ],
);

// ─── Accounts (Plaid account snapshot — balances live here) ────────

export const financeAccounts = pgTable(
  "finance_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    dataSourceConnectionId: uuid("data_source_connection_id")
      .notNull()
      .references(() => dataSourceConnections.id, { onDelete: "cascade" }),
    plaidAccountId: varchar("plaid_account_id", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }),
    mask: varchar("mask", { length: 10 }),
    type: varchar("type", { length: 20 }),
    subtype: varchar("subtype", { length: 30 }),
    currentBalance: decimal("current_balance", { precision: 14, scale: 2 }),
    availableBalance: decimal("available_balance", { precision: 14, scale: 2 }),
    isoCurrencyCode: varchar("iso_currency_code", { length: 3 }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_finance_accounts_instance").on(table.agentInstanceId),
  ],
);

// ─── Recurring Streams (Plaid /transactions/recurring/get cache) ───

export const financeRecurringStreams = pgTable(
  "finance_recurring_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    plaidStreamId: varchar("plaid_stream_id", { length: 255 }).notNull(),
    direction: varchar("direction", { length: 10 }).notNull(), // inflow | outflow
    plaidAccountId: varchar("plaid_account_id", { length: 255 }),
    merchantName: varchar("merchant_name", { length: 255 }),
    description: text("description"),
    averageAmount: decimal("average_amount", { precision: 14, scale: 2 }).notNull(),
    frequency: varchar("frequency", { length: 30 }).notNull(),
    lastDate: date("last_date"),
    predictedNextDate: date("predicted_next_date"),
    firstDate: date("first_date"),
    status: varchar("status", { length: 30 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_recurring_streams_instance_stream").on(
      table.agentInstanceId,
      table.plaidStreamId,
    ),
    index("idx_recurring_streams_dir").on(table.agentInstanceId, table.direction),
  ],
);

// ─── Briefs (The Finance agent's home screen output) ───────────────

export const financeBriefs = pgTable(
  "finance_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    verdict: text("verdict").notNull(),
    numbers: jsonb("numbers").notNull(),          // [{ value, phrase }, ...]
    paragraph: text("paragraph").notNull(),
    dataScope: text("data_scope").notNull(),
    digestSnapshot: jsonb("digest_snapshot").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_finance_briefs_user_latest").on(table.userId, table.generatedAt),
    index("idx_finance_briefs_instance_latest").on(
      table.agentInstanceId,
      table.generatedAt,
    ),
  ],
);

// ─── Insights (generated by skills, shown in feed) ─────────────────

export const financeInsights = pgTable(
  "finance_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    date: date("date").notNull(), // The date this insight is for
    skill: varchar("skill", { length: 50 }).notNull(), // e.g., "subscription-radar"
    type: varchar("type", { length: 50 }).notNull(), // e.g., "upcoming", "new", "price-change"
    priority: varchar("priority", { length: 10 }).notNull(), // "high" | "low"
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data"), // Skill-specific data (merchantId, amount, streamId, etc.)
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_finance_insights_user_date").on(table.userId, table.date),
    index("idx_finance_insights_instance").on(table.agentInstanceId, table.date),
    index("idx_finance_insights_skill").on(table.skill, table.type),
  ],
);

// ─── Recurring Stream Snapshots (for detecting new/cancelled subs) ──

export const financeRecurringSnapshots = pgTable(
  "finance_recurring_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    streams: jsonb("streams").notNull(), // Array of stream objects
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_recurring_snapshots_instance_date").on(
      table.agentInstanceId,
      table.snapshotDate,
    ),
  ],
);

// ─── File Uploads ──────────────────────────────────────────────────

export const fileUploads = pgTable("file_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  dataSourceConnectionId: uuid("data_source_connection_id")
    .notNull()
    .references(() => dataSourceConnections.id, { onDelete: "cascade" }),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 20 }).notNull(),
  storagePath: varchar("storage_path", { length: 500 }).notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  extractionStatus: varchar("extraction_status", { length: 20 }).default("pending"),
  extractionResult: jsonb("extraction_result"),
  transactionCount: integer("transaction_count"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});
