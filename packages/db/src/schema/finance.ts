import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  decimal,
  integer,
  boolean,
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
      .references(() => dataSourceConnections.id, { onDelete: "set null" }),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => financeAccounts.id, {
      onDelete: "cascade",
    }),
    transactionDate: date("transaction_date").notNull(),
    description: text("description").notNull(),
    merchantName: varchar("merchant_name", { length: 255 }),
    merchantNormalized: varchar("merchant_normalized", { length: 255 }),
    descriptionHash: varchar("description_hash", { length: 64 }),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    category: varchar("category", { length: 30 }),
    isRecurring: boolean("is_recurring").default(false),
    merchantClusterId: uuid("merchant_cluster_id").references(
      () => merchantClusters.id,
      { onDelete: "set null" },
    ),
    accountName: varchar("account_name", { length: 100 }),
    source: varchar("source", { length: 20 }).notNull(),
    plaidTransactionId: varchar("plaid_transaction_id", { length: 255 }).unique(),
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
    index("idx_finance_tx_account_id").on(table.accountId),
    index("idx_finance_tx_cluster").on(table.merchantClusterId),
    uniqueIndex("idx_finance_tx_dedup").on(
      table.accountId,
      table.transactionDate,
      table.amount,
      table.descriptionHash,
    ),
  ],
);

// ─── Accounts (source-agnostic: Plaid or file upload) ──────────────
// Identity across sources: (agent_instance_id, institution_name, account_last4)

export const financeAccounts = pgTable(
  "finance_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    dataSourceConnectionId: uuid("data_source_connection_id").references(
      () => dataSourceConnections.id,
      { onDelete: "set null" },
    ),
    institutionName: varchar("institution_name", { length: 100 }),
    accountLast4: varchar("account_last4", { length: 4 }),
    plaidAccountId: varchar("plaid_account_id", { length: 255 }).unique(),
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
    uniqueIndex("idx_finance_accounts_identity").on(
      table.agentInstanceId,
      table.institutionName,
      table.accountLast4,
    ),
  ],
);

// ─── Merchant Clusters (per-user LLM classification of a merchant) ─
// One row per (agent_instance, merchant_normalized). Replaces Plaid recurring
// detection. The LLM looks at all transactions for a merchant and decides:
// category, whether it's recurring, cadence, and a monthly amount estimate.

export const merchantClusters = pgTable(
  "merchant_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    merchantNormalized: varchar("merchant_normalized", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    // One of: income, subscription, loan_emi, fee_interest, variable_recurring,
    // internal_transfer, miscellaneous
    category: varchar("category", { length: 30 }).notNull(),
    isRecurring: boolean("is_recurring").default(false).notNull(),
    cadence: varchar("cadence", { length: 20 }), // monthly | weekly | quarterly | annual | irregular | one_time
    monthlyAmount: decimal("monthly_amount", { precision: 14, scale: 2 }),
    txnCount: integer("txn_count").default(0).notNull(),
    totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).default("0").notNull(),
    firstSeenDate: date("first_seen_date"),
    lastSeenDate: date("last_seen_date"),
    confidence: decimal("confidence", { precision: 3, scale: 2 }),
    reasoning: text("reasoning"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_merchant_clusters_unique").on(
      table.agentInstanceId,
      table.merchantNormalized,
    ),
    index("idx_merchant_clusters_category").on(
      table.agentInstanceId,
      table.category,
    ),
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
