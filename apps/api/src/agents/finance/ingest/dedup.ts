import { db, financeTransactions } from "@artifigenz/db";
import { descriptionHash, normalizeMerchant } from "./normalize-merchant";

export type TxSource = "plaid" | "statement" | "manual";

export interface RawTransaction {
  transactionDate: string;
  postedDate?: string | null;
  authorizedDate?: string | null;
  description: string;
  merchantName: string | null;
  amount: string;
  source: TxSource;
  /** Generic source-tx-id. For plaid rows, callers can leave this and let
   *  prepareTransaction mirror plaidTransactionId into it. */
  sourceTransactionId?: string | null;
  accountName?: string | null;
  /** Denormalized snapshot from finance_accounts so each txn carries enough
   *  context to be interpreted without a join. */
  accountType?: string | null;
  accountMask?: string | null;
  currency?: string | null;
  institutionId?: string | null;
  plaidTransactionId?: string | null;
  plaidAccountId?: string | null;
  pending?: number | null;
  personalFinanceCategoryPrimary?: string | null;
  personalFinanceCategoryDetailed?: string | null;
  rawData?: Record<string, unknown> | null;
}

export interface InsertableTransaction extends RawTransaction {
  agentInstanceId: string;
  userId: string | null;
  accountId: string;
  dataSourceConnectionId: string | null;
  merchantNormalized: string;
  descriptionHash: string;
  normalizedDescription: string;
  direction: "in" | "out" | null;
}

/**
 * Cheap description normalization — lowercase, collapse whitespace, trim.
 * Distinct from `normalizeMerchant` which strips a lot more (store numbers,
 * phone fragments, etc.). This one keeps the full description content so
 * downstream search / dedup can still rely on uniqueness.
 */
function normalizeDescription(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Convert a raw transaction into the shape that goes into finance_transactions.
 * Populates merchant_normalized, description_hash, normalized_description, and
 * direction so the canonical model fields are set going forward.
 */
export function prepareTransaction(args: {
  raw: RawTransaction;
  agentInstanceId: string;
  userId: string | null;
  accountId: string;
  dataSourceConnectionId: string | null;
}): InsertableTransaction {
  const { raw, agentInstanceId, userId, accountId, dataSourceConnectionId } =
    args;
  const amt = parseFloat(raw.amount);
  const direction: "in" | "out" | null =
    amt > 0 ? "out" : amt < 0 ? "in" : null;
  return {
    ...raw,
    agentInstanceId,
    userId,
    accountId,
    dataSourceConnectionId,
    merchantNormalized: normalizeMerchant(raw.merchantName ?? raw.description),
    descriptionHash: descriptionHash(raw.description),
    normalizedDescription: normalizeDescription(raw.description),
    direction,
    sourceTransactionId:
      raw.sourceTransactionId ??
      (raw.source === "plaid" ? raw.plaidTransactionId ?? null : null),
  };
}

export interface IngestStats {
  inserted: number;
  skipped: number;
  /** Per-row insert failures (not conflicts — actual exceptions). Surfaced
   *  so the caller can decide whether to log/escalate; non-empty means a
   *  schema mismatch, FK violation, or similar that onConflictDoNothing
   *  did not absorb. */
  errors: Array<{ index: number; error: string; sample: InsertSampleSnapshot }>;
}

export interface InsertSampleSnapshot {
  source: string;
  agentInstanceId: string;
  accountId: string;
  transactionDate: string;
  amount: string;
  description: string;
}

/**
 * Insert prepared transactions; relies on the unique dedup index
 * (account_id, date, amount, description_hash) to skip duplicates regardless
 * of source. Plaid txns get a second guard via the plaid_transaction_id unique
 * constraint.
 *
 * Each row is inserted in its own try/catch so a single bad row (e.g. a
 * schema mismatch or FK violation) doesn't abort the whole batch and end
 * up looking like "Plaid returned nothing" upstream.
 */
export async function insertTransactions(
  txs: InsertableTransaction[],
): Promise<IngestStats> {
  let inserted = 0;
  let skipped = 0;
  const errors: IngestStats["errors"] = [];

  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    try {
      const result = await db
        .insert(financeTransactions)
        .values({
          agentInstanceId: tx.agentInstanceId,
          userId: tx.userId,
          accountId: tx.accountId,
          dataSourceConnectionId: tx.dataSourceConnectionId,
          institutionId: tx.institutionId ?? null,
          source: tx.source,
          sourceTransactionId: tx.sourceTransactionId ?? null,
          transactionDate: tx.transactionDate,
          postedDate: tx.postedDate ?? null,
          authorizedDate: tx.authorizedDate ?? null,
          amount: tx.amount,
          direction: tx.direction,
          description: tx.description,
          normalizedDescription: tx.normalizedDescription,
          merchantName: tx.merchantName,
          merchantNormalized: tx.merchantNormalized,
          descriptionHash: tx.descriptionHash,
          accountType: tx.accountType ?? null,
          accountMask: tx.accountMask ?? null,
          currency: tx.currency ?? null,
          accountName: tx.accountName ?? null,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const sample: InsertSampleSnapshot = {
        source: tx.source,
        agentInstanceId: tx.agentInstanceId,
        accountId: tx.accountId,
        transactionDate: tx.transactionDate,
        amount: tx.amount,
        description: tx.description.slice(0, 80),
      };
      errors.push({ index: i, error: message, sample });
      console.error(
        `[insertTransactions] row ${i} failed (${tx.source}/${tx.accountId}): ${message}`,
        sample,
      );
    }
  }

  return { inserted, skipped, errors };
}
