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
import { agentInstances, dataSourceConnections } from "./platform";

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
