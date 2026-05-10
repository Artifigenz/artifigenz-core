import { eq } from "drizzle-orm";
import type { Transaction as PlaidTransaction, AccountBase } from "plaid";
import { db, dataSourceConnections } from "@artifigenz/db";
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
}

/**
 * Full ingest path for a Plaid connection:
 *   1. fetch accounts + balances → upsert finance_accounts
 *   2. sync transactions via cursor → dedup + insert finance_transactions
 *
 * Replaces the old phase1-accounts.ts + plaid.adapter.sync() write logic.
 * Idempotent: re-runs are safe thanks to the dedup index and upsertAccount.
 */
export async function ingestPlaidConnection(
  connectionId: string,
): Promise<PlaidIngestResult> {
  const [conn] = await db
    .select({
      id: dataSourceConnections.id,
      agentInstanceId: dataSourceConnections.agentInstanceId,
      credentialsEncrypted: dataSourceConnections.credentialsEncrypted,
      metadata: dataSourceConnections.metadata,
      syncCursor: dataSourceConnections.syncCursor,
    })
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.id, connectionId))
    .limit(1);

  if (!conn) throw new Error(`Connection ${connectionId} not found`);

  const creds = conn.credentialsEncrypted as unknown as PlaidCredentials;
  const meta = (conn.metadata ?? {}) as PlaidMetadata;
  const institutionName = meta.institutionName ?? "Unknown Bank";

  const plaid = getPlaidClient();

  // 1. Accounts + balances
  const accountsResp = await plaid.accountsGet({ access_token: creds.accessToken });
  const plaidAccountToId = new Map<string, string>();
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
  }

  // 2. Transactions sync
  // After Plaid Link finishes, the very first /transactions/sync call often
  // returns added=[] with next_cursor="" because Plaid is still backfilling
  // history. Production normally signals readiness via a webhook (~30-90s).
  // To avoid the "TD has 0 txns" experience during onboarding, retry with
  // backoff if we get an empty initial pull and no stored cursor yet.
  const isInitialPull = !conn.syncCursor;
  let cursor = conn.syncCursor ?? undefined;
  const added: PlaidTransaction[] = [];
  const modified: PlaidTransaction[] = [];
  const removed: string[] = [];
  let hasMore = true;

  const initialBackoffsMs = isInitialPull ? [0, 8_000, 15_000, 25_000] : [0];
  let receivedAnyAdded = false;

  for (const wait of initialBackoffsMs) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

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

    if (added.length > 0) {
      receivedAnyAdded = true;
      break;
    }
    if (!isInitialPull) break;
    // Reset has_more so the next backoff iteration polls again.
    hasMore = true;
  }

  if (isInitialPull && !receivedAnyAdded) {
    console.warn(
      `[plaid-ingest] ${connectionId}: initial pull stayed empty after backoff — ` +
        `Plaid is still backfilling. The webhook handler will pick up txns when ready.`,
    );
  }

  const prepared = added
    .filter((tx) => !tx.pending)
    .map((tx) => {
      const accountId = plaidAccountToId.get(tx.account_id);
      if (!accountId) return null;
      return prepareTransaction({
        raw: {
          transactionDate: tx.date,
          description: tx.name,
          merchantName: tx.merchant_name ?? null,
          amount: tx.amount.toString(),
          source: "plaid",
          accountName: null,
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
        accountId,
        dataSourceConnectionId: conn.id,
      });
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const stats = await insertTransactions(prepared);

  // Update cursor + sync health
  await db
    .update(dataSourceConnections)
    .set({
      syncCursor: cursor,
      lastSyncedAt: new Date(),
      lastSyncStatus: "success",
      lastSyncError: null,
      requiresReauth: false,
      consecutiveFailures: 0,
      updatedAt: new Date(),
    })
    .where(eq(dataSourceConnections.id, conn.id));

  return {
    accountsUpserted: plaidAccountToId.size,
    transactionsInserted: stats.inserted,
    transactionsSkipped: stats.skipped,
    transactionsModified: modified.length,
    transactionsRemoved: removed.length,
  };
}
