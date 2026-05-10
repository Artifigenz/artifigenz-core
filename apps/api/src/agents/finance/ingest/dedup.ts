import { db, financeTransactions } from "@artifigenz/db";
import { descriptionHash, normalizeMerchant } from "./normalize-merchant";

export interface RawTransaction {
  transactionDate: string;
  description: string;
  merchantName: string | null;
  amount: string;
  source: "plaid" | "upload";
  accountName?: string | null;
  plaidTransactionId?: string | null;
  plaidAccountId?: string | null;
  pending?: number | null;
  personalFinanceCategoryPrimary?: string | null;
  personalFinanceCategoryDetailed?: string | null;
  rawData?: Record<string, unknown> | null;
}

export interface InsertableTransaction extends RawTransaction {
  agentInstanceId: string;
  accountId: string;
  dataSourceConnectionId: string | null;
  merchantNormalized: string;
  descriptionHash: string;
}

/**
 * Convert a raw transaction into the shape that goes into finance_transactions.
 * Populates merchant_normalized and description_hash so the unique dedup index
 * can do its job.
 */
export function prepareTransaction(args: {
  raw: RawTransaction;
  agentInstanceId: string;
  accountId: string;
  dataSourceConnectionId: string | null;
}): InsertableTransaction {
  const { raw, agentInstanceId, accountId, dataSourceConnectionId } = args;
  return {
    ...raw,
    agentInstanceId,
    accountId,
    dataSourceConnectionId,
    merchantNormalized: normalizeMerchant(raw.merchantName ?? raw.description),
    descriptionHash: descriptionHash(raw.description),
  };
}

export interface IngestStats {
  inserted: number;
  skipped: number;
}

/**
 * Insert prepared transactions; relies on the unique dedup index
 * (account_id, date, amount, description_hash) to skip duplicates regardless
 * of source. Plaid txns get a second guard via the plaid_transaction_id unique
 * constraint.
 */
export async function insertTransactions(
  txs: InsertableTransaction[],
): Promise<IngestStats> {
  let inserted = 0;
  let skipped = 0;

  for (const tx of txs) {
    const result = await db
      .insert(financeTransactions)
      .values({
        agentInstanceId: tx.agentInstanceId,
        accountId: tx.accountId,
        dataSourceConnectionId: tx.dataSourceConnectionId,
        transactionDate: tx.transactionDate,
        description: tx.description,
        merchantName: tx.merchantName,
        merchantNormalized: tx.merchantNormalized,
        descriptionHash: tx.descriptionHash,
        amount: tx.amount,
        accountName: tx.accountName ?? null,
        source: tx.source,
        plaidTransactionId: tx.plaidTransactionId ?? null,
        plaidAccountId: tx.plaidAccountId ?? null,
        pending: tx.pending ?? 0,
        personalFinanceCategoryPrimary:
          tx.personalFinanceCategoryPrimary ?? null,
        personalFinanceCategoryDetailed:
          tx.personalFinanceCategoryDetailed ?? null,
        rawData: tx.rawData ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: financeTransactions.id });

    if (result.length > 0) inserted++;
    else skipped++;
  }

  return { inserted, skipped };
}
