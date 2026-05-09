import { eq, and } from "drizzle-orm";
import {
  db,
  dataSourceConnections,
  financeTransactions,
} from "@artifigenz/db";
import { type Transaction as PlaidTransaction } from "plaid";
import { getPlaidClient } from "../../lib/plaid-client";

interface PlaidCredentials {
  accessToken: string;
  itemId: string;
}

/**
 * Runs /transactions/sync for every Plaid connection on the agent instance and
 * upserts into finance_transactions. Mirrors the logic inside plaidAdapter.sync()
 * but writes the extra columns the Brief math needs (plaid_account_id, pending,
 * personal finance categories). Safe to call repeatedly — uses the per-connection
 * sync cursor.
 */
export async function syncTransactionsForInstance(
  agentInstanceId: string,
): Promise<void> {
  // Select only columns we need (avoid new health columns that may not exist)
  const connections = await db
    .select({
      id: dataSourceConnections.id,
      agentInstanceId: dataSourceConnections.agentInstanceId,
      credentialsEncrypted: dataSourceConnections.credentialsEncrypted,
      syncCursor: dataSourceConnections.syncCursor,
    })
    .from(dataSourceConnections)
    .where(
      and(
        eq(dataSourceConnections.agentInstanceId, agentInstanceId),
        eq(dataSourceConnections.dataSourceTypeId, "plaid"),
        eq(dataSourceConnections.status, "active"),
      ),
    );

  const plaid = getPlaidClient();

  for (const conn of connections) {
    const creds = conn.credentialsEncrypted as unknown as PlaidCredentials | null;
    if (!creds?.accessToken) continue;

    let cursor = conn.syncCursor ?? undefined;
    let hasMore = true;
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: string[] = [];
    let syncFailed = false;

    while (hasMore) {
      try {
        const response = await plaid.transactionsSync({
          access_token: creds.accessToken,
          cursor,
        });
        added.push(...response.data.added);
        modified.push(...response.data.modified);
        removed.push(...response.data.removed.map((r) => r.transaction_id));
        cursor = response.data.next_cursor;
        hasMore = response.data.has_more;
      } catch (err) {
        const data = (err as { response?: { data?: { error_code?: string; error_message?: string } } })
          .response?.data;
        console.warn(
          `[Brief/sync] Skipping connection ${conn.id}: ${data?.error_code ?? "unknown"} — ${data?.error_message ?? String(err)}`,
        );
        syncFailed = true;
        break;
      }
    }

    if (syncFailed) continue;

    // Build account name lookup for display.
    let accountsResponse;
    try {
      accountsResponse = await plaid.accountsGet({
        access_token: creds.accessToken,
      });
    } catch {
      continue;
    }
    const accountNameMap = new Map<string, string>();
    for (const acc of accountsResponse.data.accounts) {
      accountNameMap.set(acc.account_id, acc.name);
    }

    for (const tx of added) {
      await db
        .insert(financeTransactions)
        .values({
          agentInstanceId: conn.agentInstanceId,
          dataSourceConnectionId: conn.id,
          transactionDate: tx.date,
          description: tx.name,
          merchantName: tx.merchant_name ?? null,
          amount: tx.amount.toString(),
          category: tx.personal_finance_category?.primary ?? null,
          accountName: accountNameMap.get(tx.account_id) ?? null,
          source: "plaid",
          plaidTransactionId: tx.transaction_id,
          plaidAccountId: tx.account_id,
          pending: tx.pending ? 1 : 0,
          personalFinanceCategoryPrimary: tx.personal_finance_category?.primary ?? null,
          personalFinanceCategoryDetailed:
            tx.personal_finance_category?.detailed ?? null,
          rawData: tx as unknown as Record<string, unknown>,
        })
        // If a legacy row exists without the Brief-specific columns, backfill them
        // on conflict. Idempotent for rows that already have values.
        .onConflictDoUpdate({
          target: financeTransactions.plaidTransactionId,
          set: {
            plaidAccountId: tx.account_id,
            pending: tx.pending ? 1 : 0,
            personalFinanceCategoryPrimary: tx.personal_finance_category?.primary ?? null,
            personalFinanceCategoryDetailed:
              tx.personal_finance_category?.detailed ?? null,
          },
        });
    }

    for (const tx of modified) {
      await db
        .update(financeTransactions)
        .set({
          description: tx.name,
          merchantName: tx.merchant_name ?? null,
          amount: tx.amount.toString(),
          category: tx.personal_finance_category?.primary ?? null,
          plaidAccountId: tx.account_id,
          pending: tx.pending ? 1 : 0,
          personalFinanceCategoryPrimary: tx.personal_finance_category?.primary ?? null,
          personalFinanceCategoryDetailed:
            tx.personal_finance_category?.detailed ?? null,
        })
        .where(eq(financeTransactions.plaidTransactionId, tx.transaction_id));
    }

    for (const txId of removed) {
      await db
        .delete(financeTransactions)
        .where(eq(financeTransactions.plaidTransactionId, txId));
    }

    await db
      .update(dataSourceConnections)
      .set({
        syncCursor: cursor,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dataSourceConnections.id, conn.id));

    console.log(
      `[Brief/sync] ${conn.id}: +${added.length} added, ~${modified.length} modified, -${removed.length} removed`,
    );
  }
}
