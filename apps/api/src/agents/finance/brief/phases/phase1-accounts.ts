import { eq, and } from "drizzle-orm";
import {
  db,
  dataSourceConnections,
  financeAccounts,
} from "@artifigenz/db";
import { getPlaidClient } from "../../lib/plaid-client";
import type { DigestAccount } from "../helpers/types";

interface PlaidCredentials {
  accessToken: string;
  itemId: string;
}

/**
 * Phase 1 — Fetch accounts + balances for every Plaid connection on the agent
 * instance. Upserts into finance_accounts. Spec §3.2.
 */
export async function phase1FetchAccounts(
  agentInstanceId: string,
): Promise<DigestAccount[]> {
  // Select only columns we need (avoid new health columns that may not exist)
  const connections = await db
    .select({
      id: dataSourceConnections.id,
      agentInstanceId: dataSourceConnections.agentInstanceId,
      credentialsEncrypted: dataSourceConnections.credentialsEncrypted,
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
  const now = new Date();
  const accounts: DigestAccount[] = [];

  for (const conn of connections) {
    const creds = conn.credentialsEncrypted as unknown as PlaidCredentials | null;
    if (!creds?.accessToken) continue;

    // Some institutions (Capital One ins_128026) require min_last_updated_datetime.
    // Accept cached balance up to 24h old; Plaid will refresh if older.
    const minUpdated = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let response;
    try {
      response = await plaid.accountsBalanceGet({
        access_token: creds.accessToken,
        options: { min_last_updated_datetime: minUpdated },
      });
    } catch (err) {
      const data = (err as { response?: { data?: { error_code?: string; error_message?: string } } })
        .response?.data;
      console.warn(
        `[Phase1] Skipping connection ${conn.id} (${conn.displayName ?? "unknown"}): ${data?.error_code ?? "unknown"} — ${data?.error_message ?? String(err)}`,
      );
      // If the item needs re-auth, mark it so the UI can prompt later.
      if (data?.error_code === "ITEM_LOGIN_REQUIRED") {
        await db
          .update(dataSourceConnections)
          .set({ status: "login_required", updatedAt: new Date() })
          .where(eq(dataSourceConnections.id, conn.id));
      }
      continue;
    }

    for (const acc of response.data.accounts) {
      const current = acc.balances.current ?? null;
      const available = acc.balances.available ?? null;

      await db
        .insert(financeAccounts)
        .values({
          agentInstanceId,
          dataSourceConnectionId: conn.id,
          plaidAccountId: acc.account_id,
          name: acc.name ?? null,
          mask: acc.mask ?? null,
          type: acc.type ?? null,
          subtype: acc.subtype ?? null,
          currentBalance: current !== null ? current.toString() : null,
          availableBalance: available !== null ? available.toString() : null,
          isoCurrencyCode: acc.balances.iso_currency_code ?? null,
          lastSyncedAt: now,
        })
        .onConflictDoUpdate({
          target: financeAccounts.plaidAccountId,
          set: {
            name: acc.name ?? null,
            mask: acc.mask ?? null,
            type: acc.type ?? null,
            subtype: acc.subtype ?? null,
            currentBalance: current !== null ? current.toString() : null,
            availableBalance: available !== null ? available.toString() : null,
            isoCurrencyCode: acc.balances.iso_currency_code ?? null,
            lastSyncedAt: now,
          },
        });

      accounts.push({
        plaidAccountId: acc.account_id,
        type: acc.type ?? null,
        subtype: acc.subtype ?? null,
        currentBalance: current,
        availableBalance: available,
        isoCurrencyCode: acc.balances.iso_currency_code ?? null,
      });
    }
  }

  return accounts;
}
