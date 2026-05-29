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
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => financeAccounts.id, {
      onDelete: "cascade",
    }),
    // Stage 0 spec: institutionId (denormalized from accounts/connections)
    institutionId: varchar("institution_id", { length: 100 }),
    // Spec: "plaid" | "statement" | "manual". Existing "upload" rows are
    // backfilled to "statement" in migration 0008.
    source: varchar("source", { length: 20 }).notNull(),
    // Generic source-tx-id. For Plaid rows, mirrors plaidTransactionId.
    sourceTransactionId: varchar("source_transaction_id", { length: 255 }),

    transactionDate: date("transaction_date").notNull(),
    postedDate: date("posted_date"),
    authorizedDate: date("authorized_date"),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    // "in" (negative amount, money entering) or "out" (positive, money
    // leaving). Derived from sign at write time but persisted so consumers
    // don't have to re-derive.
    direction: varchar("direction", { length: 3 }),

    description: text("description").notNull(),
    normalizedDescription: text("normalized_description"),
    merchantName: varchar("merchant_name", { length: 255 }),
    merchantNormalized: varchar("merchant_normalized", { length: 255 }),
    descriptionHash: varchar("description_hash", { length: 64 }),

    // Denormalized snapshots from finance_accounts (Stage 0 spec carries
    // these on the txn so downstream consumers don't have to join).
    accountType: varchar("account_type", { length: 20 }),
    accountMask: varchar("account_mask", { length: 10 }),
    currency: varchar("currency", { length: 3 }),
    accountName: varchar("account_name", { length: 100 }),

    category: varchar("category", { length: 30 }),
    // Hidden engine-only label that gives downstream aggregators extra
    // context the visible category alone can't carry — e.g.
    // 'credit_card_payment' so we don't double-count a card-pay transfer
    // as spend, or 'refund_or_reversal' so a refund doesn't inflate
    // income. Most rows leave this null.
    systemCategory: varchar("system_category", { length: 40 }),
    isRecurring: boolean("is_recurring").default(false),
    merchantClusterId: uuid("merchant_cluster_id").references(
      () => merchantClusters.id,
      { onDelete: "set null" },
    ),
    // Per-txn categorization metadata (the cluster has its own; these let
    // the user override one txn without affecting the cluster).
    confidence: decimal("confidence", { precision: 3, scale: 2 }),
    categorizationSource: varchar("categorization_source", { length: 10 }),
    reasoning: text("reasoning"),
    needsReview: boolean("needs_review").default(false),

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
    // Hidden engine-only label (refund_or_reversal, credit_card_payment,
    // investment_transfer, cash_withdrawal, possible_internal_transfer,
    // uncategorized_needs_review). Null when the visible category alone
    // is enough context. See docs/categorization-engine.md.
    systemCategory: varchar("system_category", { length: 40 }),
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

// ─── Merchant Brands (global enrichment cache) ────────────────────
// Cross-user cache of brand metadata keyed by merchant_normalized. The same
// "amzn mktp" string is Amazon for every user, so we lookup/write once and
// every agent_instance benefits. Per-user category/cadence/recurring stays
// on merchant_clusters; this table is identity/branding only.
//
// Source priority (cheapest first):
//   plaid        — Plaid's personal_finance_category + merchant_entity_id +
//                  logo_url, pulled free from raw_data on ingest
//   brand_api    — Brandfetch / Logo.dev for non-Plaid sources
//   llm          — Claude with web search for the long tail
//   manual       — user-supplied override (highest trust, never overwritten)
// A later source never overwrites a higher-trust one unless source='manual'
// is set explicitly.

export const merchantBrands = pgTable(
  "merchant_brands",
  {
    // The alias key. Multiple merchant_normalized strings can point at the
    // same brand_slug — that's how BC Ferries' "bcf - alberni _m",
    // "bcf-customer se _v", and "bcf" all collapse into one brand at read
    // time. The row IS both the alias and the brand denormalized inline.
    merchantNormalized: varchar("merchant_normalized", { length: 255 })
      .primaryKey(),
    // The canonical brand entity key. Stable across normalized variants
    // and across users. Kebab-cased from display_name (e.g., "bc-ferries",
    // "amazon"). The clustering join key going forward — the UI groups
    // transactions by this column.
    brandSlug: varchar("brand_slug", { length: 64 }),
    displayName: varchar("display_name", { length: 255 }),
    logoUrl: text("logo_url"),
    website: varchar("website", { length: 255 }),
    brandColor: varchar("brand_color", { length: 7 }), // hex like #FF6900
    industry: varchar("industry", { length: 60 }),
    source: varchar("source", { length: 16 }).notNull(), // plaid | brand_api | llm | manual
    confidence: decimal("confidence", { precision: 3, scale: 2 }), // 0.00 - 1.00
    // Free-form payload from the source — Plaid's PFC primary/detailed,
    // raw API responses, LLM reasoning, etc. Kept so we can re-derive later.
    rawData: jsonb("raw_data"),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_merchant_brands_source").on(table.source),
    // Cluster lookups join transactions to brands and group by brand_slug.
    // This index makes the groupby cheap.
    index("idx_merchant_brands_slug").on(table.brandSlug),
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
// Two-phase parse lifecycle:
//   pending    — file saved, not yet validated
//   validated  — Claude confirmed it's a statement + extracted institution,
//                last4, type, period. No transactions yet.
//   parsing    — full transaction extraction in flight
//   complete   — transactions inserted into finance_transactions
//   failed     — either validation said "not a statement" or parse errored

export const fileUploads = pgTable("file_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  dataSourceConnectionId: uuid("data_source_connection_id")
    .notNull()
    .references(() => dataSourceConnections.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => financeAccounts.id, {
    onDelete: "set null",
  }),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 20 }).notNull(),
  storagePath: varchar("storage_path", { length: 500 }).notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  // Phase tracking
  parseState: varchar("parse_state", { length: 20 }).default("pending").notNull(),
  parseError: text("parse_error"),
  // Metadata captured during validation (before full parse)
  institutionName: varchar("institution_name", { length: 100 }),
  accountLast4: varchar("account_last4", { length: 4 }),
  accountType: varchar("account_type", { length: 20 }),
  statementPeriodStart: date("statement_period_start"),
  statementPeriodEnd: date("statement_period_end"),
  // Filled after full parse
  extractionStatus: varchar("extraction_status", { length: 20 }).default("pending"),
  extractionResult: jsonb("extraction_result"),
  transactionCount: integer("transaction_count"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});
