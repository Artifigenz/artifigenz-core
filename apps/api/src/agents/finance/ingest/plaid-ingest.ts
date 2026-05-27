import { and, eq, sql } from "drizzle-orm";
import type { Transaction as PlaidTransaction, AccountBase } from "plaid";
import {
  db,
  dataSourceConnections,
  financeAccounts,
  financeTransactions,
  agentInstances,
} from "@artifigenz/db";
import { getPlaidClient } from "../lib/plaid-client";
import { upsertAccount } from "./account-matcher";
import { insertTransactions, prepareTransaction } from "./dedup";

interface PlaidCredentials {
  accessToken: string;
  itemId: string;
}

interface PlaidMetadata {
  institutionName?: string;
  institutionId?: string;
}

export interface PlaidIngestResult {
  accountsUpserted: number;
  transactionsInserted: number;
  transactionsSkipped: number;
  transactionsModified: number;
  transactionsRemoved: number;
  /** Updated ingestion_state after this sync — useful for callers. */
  ingestionState:
    | "pending"
    | "in_progress"
    | "complete"
    | "needs_auth"
    | "failed";
  /** True when this call did nothing because another ingest is already running. */
  skippedInFlight: boolean;
}

// How many consecutive zero-add syncs before we declare Plaid finished —
// but only AFTER we've actually pulled at least one transaction. Without
// any transactions on the connection, 3 empty syncs likely means Plaid
// hasn't started its initial backfill yet, not that we're caught up.
// 3 × 30s polling interval = ~90s of stability.
const COMPLETE_AFTER_EMPTY_SYNCS = 3;
// When we have zero transactions, require Plaid's item.status.transactions
// to show a last_successful_update before we'll accept "0 txns" as truth.
// Until then, keep the connection in_progress so the loading screen waits.
const TIMEOUT_MINUTES = 30;
// Mark connection failed after this many consecutive errored syncs.
const FAIL_AFTER_ERRORS = 10;

/**
 * Full ingest path for one Plaid connection.
 *
 * Drives the ingestion state machine on data_source_connections:
 *   pending → in_progress → complete | needs_auth | failed
 *
 * Idempotent and concurrency-safe: the ingestion_in_flight flag prevents
 * the frontend poll and the Plaid webhook from racing the same /sync call.
 * The dedup unique index makes any actual race harmless.
 */
export async function ingestPlaidConnection(
  connectionId: string,
): Promise<PlaidIngestResult> {
  // Try to acquire the in-flight soft lock. If another ingest is already
  // running for this connection, bail out fast with skippedInFlight=true.
  const acquired = await db
    .update(dataSourceConnections)
    .set({ ingestionInFlight: true, updatedAt: new Date() })
    .where(
      and(
        eq(dataSourceConnections.id, connectionId),
        eq(dataSourceConnections.ingestionInFlight, false),
      ),
    )
    .returning({ id: dataSourceConnections.id });

  if (acquired.length === 0) {
    const [current] = await db
      .select({ ingestionState: dataSourceConnections.ingestionState })
      .from(dataSourceConnections)
      .where(eq(dataSourceConnections.id, connectionId))
      .limit(1);
    return {
      accountsUpserted: 0,
      transactionsInserted: 0,
      transactionsSkipped: 0,
      transactionsModified: 0,
      transactionsRemoved: 0,
      ingestionState: (current?.ingestionState ?? "in_progress") as PlaidIngestResult["ingestionState"],
      skippedInFlight: true,
    };
  }

  try {
    return await runIngest(connectionId);
  } finally {
    // Always release the soft lock, even on error.
    await db
      .update(dataSourceConnections)
      .set({ ingestionInFlight: false, updatedAt: new Date() })
      .where(eq(dataSourceConnections.id, connectionId));
  }
}

async function runIngest(connectionId: string): Promise<PlaidIngestResult> {
  const [conn] = await db
    .select({
      id: dataSourceConnections.id,
      agentInstanceId: dataSourceConnections.agentInstanceId,
      credentialsEncrypted: dataSourceConnections.credentialsEncrypted,
      metadata: dataSourceConnections.metadata,
      syncCursor: dataSourceConnections.syncCursor,
      ingestionState: dataSourceConnections.ingestionState,
      ingestionStartedAt: dataSourceConnections.ingestionStartedAt,
      consecutiveEmptySyncs: dataSourceConnections.consecutiveEmptySyncs,
      consecutiveFailures: dataSourceConnections.consecutiveFailures,
    })
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.id, connectionId))
    .limit(1);

  if (!conn) throw new Error(`Connection ${connectionId} not found`);

  // userId — needed for the denormalized user_id column on finance_transactions.
  const [ai] = await db
    .select({ userId: agentInstances.userId })
    .from(agentInstances)
    .where(eq(agentInstances.id, conn.agentInstanceId))
    .limit(1);
  const userId = ai?.userId ?? null;

  // First sync since the connection was created — flip pending → in_progress.
  if (conn.ingestionState === "pending") {
    await db
      .update(dataSourceConnections)
      .set({
        ingestionState: "in_progress",
        ingestionStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dataSourceConnections.id, connectionId));
  }

  const creds = conn.credentialsEncrypted as unknown as PlaidCredentials;
  const meta = (conn.metadata ?? {}) as PlaidMetadata & { institutionId?: string };
  const institutionName = meta.institutionName ?? "Unknown Bank";
  const institutionId = meta.institutionId ?? null;

  const plaid = getPlaidClient();

  // 1. Accounts + balances
  interface AccountSnapshot {
    id: string;
    type: string | null;
    mask: string | null;
    currency: string | null;
  }
  let plaidAccountToId: Map<string, string>;
  let plaidAccountSnapshots: Map<string, AccountSnapshot>;
  try {
    const accountsResp = await plaid.accountsGet({ access_token: creds.accessToken });
    plaidAccountToId = new Map<string, string>();
    plaidAccountSnapshots = new Map<string, AccountSnapshot>();
    for (const acc of accountsResp.data.accounts as AccountBase[]) {
      const last4 = acc.mask ?? "0000";
      const accountId = await upsertAccount({
        agentInstanceId: conn.agentInstanceId,
        institutionName,
        accountLast4: last4,
        dataSourceConnectionId: conn.id,
        plaidAccountId: acc.account_id,
        name: acc.name,
        mask: acc.mask,
        type: acc.type,
        subtype: acc.subtype,
        currentBalance: acc.balances?.current?.toString() ?? null,
        availableBalance: acc.balances?.available?.toString() ?? null,
        isoCurrencyCode: acc.balances?.iso_currency_code ?? null,
      });
      plaidAccountToId.set(acc.account_id, accountId);
      plaidAccountSnapshots.set(acc.account_id, {
        id: accountId,
        type: acc.type ?? null,
        mask: acc.mask ?? null,
        currency: acc.balances?.iso_currency_code ?? null,
      });
    }
  } catch (err) {
    return await handlePlaidError(connectionId, err, conn);
  }

  // 2. Transactions sync (one round of has_more loop; we don't backoff-poll
  // here — the agent-status endpoint and the webhook drive subsequent calls).
  let cursor = conn.syncCursor ?? undefined;
  const added: PlaidTransaction[] = [];
  const modified: PlaidTransaction[] = [];
  const removed: string[] = [];
  let hasMore = true;

  try {
    while (hasMore) {
      const resp = await plaid.transactionsSync({
        access_token: creds.accessToken,
        cursor,
      });
      added.push(...resp.data.added);
      modified.push(...resp.data.modified);
      removed.push(...resp.data.removed.map((r) => r.transaction_id));
      hasMore = resp.data.has_more;
      cursor = resp.data.next_cursor;
    }
  } catch (err) {
    return await handlePlaidError(connectionId, err, conn);
  }

  // 3. Apply added
  const prepared = added
    .filter((tx) => !tx.pending)
    .map((tx) => {
      const accountId = plaidAccountToId.get(tx.account_id);
      if (!accountId) return null;
      const snap = plaidAccountSnapshots.get(tx.account_id);
      return prepareTransaction({
        raw: {
          transactionDate: tx.date,
          postedDate: tx.date,
          authorizedDate: tx.authorized_date ?? null,
          description: tx.name,
          merchantName: tx.merchant_name ?? null,
          amount: tx.amount.toString(),
          source: "plaid",
          accountName: null,
          accountType: snap?.type ?? null,
          accountMask: snap?.mask ?? null,
          currency: snap?.currency ?? tx.iso_currency_code ?? null,
          institutionId,
          plaidTransactionId: tx.transaction_id,
          plaidAccountId: tx.account_id,
          pending: tx.pending ? 1 : 0,
          personalFinanceCategoryPrimary:
            tx.personal_finance_category?.primary ?? null,
          personalFinanceCategoryDetailed:
            tx.personal_finance_category?.detailed ?? null,
          rawData: tx as unknown as Record<string, unknown>,
        },
        agentInstanceId: conn.agentInstanceId,
        userId,
        accountId,
        dataSourceConnectionId: conn.id,
      });
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const stats = await insertTransactions(prepared);

  // Surface per-row insert failures into lastSyncError so the loading page
  // banner reports the real cause (schema mismatch, FK violation, etc.)
  // instead of a silent "0 transactions".
  if (stats.errors.length > 0) {
    const first = stats.errors[0];
    const summary =
      stats.errors.length === 1
        ? `Insert failed: ${first.error}`
        : `${stats.errors.length} insert failures, first: ${first.error}`;
    await db
      .update(dataSourceConnections)
      .set({
        lastSyncError: summary,
        updatedAt: new Date(),
      })
      .where(eq(dataSourceConnections.id, connectionId));
  }

  // 4. Apply modified (Plaid re-issues txns when amount/description/category
  // change — e.g. pending → posted, merchant rename). Match by plaid_transaction_id.
  // Re-run prepareTransaction so direction, normalized_description,
  // merchant_normalized, and description_hash stay consistent with the new
  // amount/description — otherwise downstream dedup and clustering drift.
  for (const tx of modified) {
    const accountId = plaidAccountToId.get(tx.account_id);
    if (!accountId) continue;
    const snap = plaidAccountSnapshots.get(tx.account_id);
    const prepared = prepareTransaction({
      raw: {
        transactionDate: tx.date,
        postedDate: tx.date,
        authorizedDate: tx.authorized_date ?? null,
        description: tx.name,
        merchantName: tx.merchant_name ?? null,
        amount: tx.amount.toString(),
        source: "plaid",
        accountName: null,
        accountType: snap?.type ?? null,
        accountMask: snap?.mask ?? null,
        currency: snap?.currency ?? tx.iso_currency_code ?? null,
        institutionId,
        plaidTransactionId: tx.transaction_id,
        plaidAccountId: tx.account_id,
        pending: tx.pending ? 1 : 0,
        personalFinanceCategoryPrimary:
          tx.personal_finance_category?.primary ?? null,
        personalFinanceCategoryDetailed:
          tx.personal_finance_category?.detailed ?? null,
        rawData: tx as unknown as Record<string, unknown>,
      },
      agentInstanceId: conn.agentInstanceId,
      userId,
      accountId,
      dataSourceConnectionId: conn.id,
    });
    await db
      .update(financeTransactions)
      .set({
        transactionDate: prepared.transactionDate,
        postedDate: prepared.postedDate ?? null,
        authorizedDate: prepared.authorizedDate ?? null,
        amount: prepared.amount,
        direction: prepared.direction,
        description: prepared.description,
        normalizedDescription: prepared.normalizedDescription,
        merchantName: prepared.merchantName,
        merchantNormalized: prepared.merchantNormalized,
        descriptionHash: prepared.descriptionHash,
        accountType: prepared.accountType ?? null,
        accountMask: prepared.accountMask ?? null,
        currency: prepared.currency ?? null,
        pending: prepared.pending ?? 0,
        personalFinanceCategoryPrimary:
          prepared.personalFinanceCategoryPrimary ?? null,
        personalFinanceCategoryDetailed:
          prepared.personalFinanceCategoryDetailed ?? null,
        rawData: prepared.rawData ?? null,
      })
      .where(eq(financeTransactions.plaidTransactionId, tx.transaction_id));
  }

  // 5. Apply removed (cancelled/voided txns). Match by plaid_transaction_id.
  for (const txId of removed) {
    await db
      .delete(financeTransactions)
      .where(eq(financeTransactions.plaidTransactionId, txId));
  }

  // 6. State transitions
  const newEmptyCount =
    stats.inserted === 0
      ? (conn.consecutiveEmptySyncs ?? 0) + 1
      : 0;

  // Hard timeout: if we've been in_progress for too long, mark complete anyway.
  const timedOut =
    conn.ingestionStartedAt !== null &&
    Date.now() - new Date(conn.ingestionStartedAt).getTime() >
      TIMEOUT_MINUTES * 60_000;

  // Cumulative txn count across this connection's accounts. If it's zero,
  // empty syncs likely mean Plaid is still backfilling history — not that
  // we've caught up — so we shouldn't transition to 'complete' yet.
  const [{ totalTxns }] = await db
    .select({ totalTxns: sql<number>`count(*)::int` })
    .from(financeTransactions)
    .innerJoin(
      financeAccounts,
      eq(financeTransactions.accountId, financeAccounts.id),
    )
    .where(eq(financeAccounts.dataSourceConnectionId, connectionId));

  // If we still have zero transactions, only accept 'complete' when Plaid's
  // own item.status confirms it has finished its initial transactions update.
  // Otherwise we'd silently mark a connection done before any history arrived.
  let plaidBackfillDone = false;
  if (totalTxns === 0) {
    try {
      const itemResp = await plaid.itemGet({ access_token: creds.accessToken });
      const txStatus = itemResp.data.status?.transactions ?? null;
      plaidBackfillDone = Boolean(txStatus?.last_successful_update);
    } catch (err) {
      // Don't fail the sync over a status probe; just stay in_progress.
      console.warn(
        `[plaid-ingest] item.status probe failed for ${connectionId}:`,
        err,
      );
    }
  }

  const stableWithData = totalTxns > 0 && newEmptyCount >= COMPLETE_AFTER_EMPTY_SYNCS;
  const stableEmpty =
    totalTxns === 0 &&
    plaidBackfillDone &&
    newEmptyCount >= COMPLETE_AFTER_EMPTY_SYNCS;

  const nextState: PlaidIngestResult["ingestionState"] =
    stableWithData || stableEmpty || timedOut ? "complete" : "in_progress";

  await db
    .update(dataSourceConnections)
    .set({
      syncCursor: cursor,
      lastSyncedAt: new Date(),
      lastSyncStatus: "success",
      lastSyncError: null,
      requiresReauth: false,
      consecutiveFailures: 0,
      lastSyncAddedCount: stats.inserted,
      consecutiveEmptySyncs: newEmptyCount,
      ingestionState: nextState,
      ingestionCompletedAt:
        nextState === "complete" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(dataSourceConnections.id, connectionId));

  return {
    accountsUpserted: plaidAccountToId.size,
    transactionsInserted: stats.inserted,
    transactionsSkipped: stats.skipped,
    transactionsModified: modified.length,
    transactionsRemoved: removed.length,
    ingestionState: nextState,
    skippedInFlight: false,
  };
}

async function handlePlaidError(
  connectionId: string,
  err: unknown,
  conn: { consecutiveFailures: number | null },
): Promise<PlaidIngestResult> {
  const plaidError = (err as { response?: { data?: { error_code?: string; error_message?: string } } })
    .response?.data;
  const errorCode = plaidError?.error_code;
  const errorMessage =
    plaidError?.error_message ?? (err instanceof Error ? err.message : "Sync failed");

  const needsAuth =
    errorCode === "ITEM_LOGIN_REQUIRED" ||
    errorCode === "INVALID_ACCESS_TOKEN" ||
    errorCode === "ITEM_LOCKED";

  const failures = (conn.consecutiveFailures ?? 0) + 1;
  const failed = !needsAuth && failures >= FAIL_AFTER_ERRORS;
  const nextState: PlaidIngestResult["ingestionState"] = needsAuth
    ? "needs_auth"
    : failed
      ? "failed"
      : "in_progress";

  await db
    .update(dataSourceConnections)
    .set({
      lastSyncStatus: "error",
      lastSyncError: errorMessage,
      requiresReauth: needsAuth,
      consecutiveFailures: failures,
      ingestionState: nextState,
      ingestionCompletedAt:
        nextState === "needs_auth" || nextState === "failed" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(dataSourceConnections.id, connectionId));

  console.error(
    `[plaid-ingest] ${connectionId} error (${errorCode ?? "?"}): ${errorMessage}`,
  );

  return {
    accountsUpserted: 0,
    transactionsInserted: 0,
    transactionsSkipped: 0,
    transactionsModified: 0,
    transactionsRemoved: 0,
    ingestionState: nextState,
    skippedInFlight: false,
  };
}
