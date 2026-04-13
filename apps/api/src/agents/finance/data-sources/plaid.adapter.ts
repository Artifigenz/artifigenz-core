import { eq } from "drizzle-orm";
import {
  CountryCode,
  Products,
  type Transaction as PlaidTransaction,
} from "plaid";
import {
  db,
  dataSourceConnections,
  financeTransactions,
  agentInstances,
  users,
} from "@artifigenz/db";
import type {
  DataSourceTypeDefinition,
  DataSourceConnectionResult,
  FinalizeParams,
  NormalizedData,
} from "../../../platform/registry/types";
import { getPlaidClient } from "../lib/plaid-client";

interface PlaidCredentials {
  accessToken: string;
  itemId: string;
}

interface PlaidMetadata {
  institutionName?: string;
  institutionId?: string;
  accounts?: Array<{ id: string; name: string; mask: string | null }>;
}

export const plaidAdapter: DataSourceTypeDefinition = {
  typeId: "plaid",
  name: "Bank Account (Plaid)",
  description: "Connect your bank accounts securely via Plaid",
  connectionFlow: "sdk",
  syncMechanism: "webhook",

  /**
   * Step 1 of the connection flow.
   * Creates a Plaid Link token that the client uses to launch the bank picker UI.
   */
  async getConnectionConfig(agentInstanceId: string) {
    // Look up user from agent instance
    const [instance] = await db
      .select({ userId: agentInstances.userId })
      .from(agentInstances)
      .where(eq(agentInstances.id, agentInstanceId))
      .limit(1);

    if (!instance) throw new Error(`Agent instance ${agentInstanceId} not found`);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, instance.userId))
      .limit(1);

    if (!user) throw new Error(`User ${instance.userId} not found`);

    const plaid = getPlaidClient();
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Artifigenz",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca, CountryCode.Gb],
      language: "en",
    });

    return {
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    };
  },

  /**
   * Step 2 of the connection flow.
   * Exchanges the public_token (from Plaid Link) for an access_token and persists it.
   */
  async finalizeConnection(params: FinalizeParams): Promise<DataSourceConnectionResult> {
    const { agentInstanceId, publicToken, metadata } = params as FinalizeParams & {
      publicToken: string;
      metadata?: PlaidMetadata;
    };

    if (!publicToken) throw new Error("publicToken is required");

    const plaid = getPlaidClient();
    const exchange = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    const credentials: PlaidCredentials = { accessToken, itemId };

    const displayName = metadata?.institutionName ?? "Bank Account";

    const [conn] = await db
      .insert(dataSourceConnections)
      .values({
        agentInstanceId,
        dataSourceTypeId: "plaid",
        displayName,
        status: "active",
        credentialsEncrypted: credentials as unknown as Record<string, unknown>,
        metadata: (metadata ?? {}) as Record<string, unknown>,
      })
      .returning();

    return {
      id: conn.id,
      agentInstanceId: conn.agentInstanceId,
      dataSourceTypeId: conn.dataSourceTypeId,
      displayName: conn.displayName ?? "",
      status: conn.status,
      credentials: credentials as unknown as Record<string, unknown>,
      metadata: (metadata ?? {}) as Record<string, unknown>,
    };
  },

  async testConnection(connection) {
    try {
      const plaid = getPlaidClient();
      const creds = connection.credentials as unknown as PlaidCredentials;
      await plaid.itemGet({ access_token: creds.accessToken });
      return true;
    } catch {
      return false;
    }
  },

  async disconnect(connection) {
    try {
      const plaid = getPlaidClient();
      const creds = connection.credentials as unknown as PlaidCredentials;
      await plaid.itemRemove({ access_token: creds.accessToken });
    } catch {
      // Ignore — we still want to remove locally
    }

    await db
      .update(dataSourceConnections)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(dataSourceConnections.id, connection.id));
  },

  /**
   * Syncs transactions using Plaid's cursor-based /transactions/sync.
   * Upserts into finance_transactions. Returns the raw transactions for downstream.
   */
  async sync(connection): Promise<NormalizedData[]> {
    // Re-fetch the connection from DB so we have fresh credentials + cursor
    const [dbConn] = await db
      .select()
      .from(dataSourceConnections)
      .where(eq(dataSourceConnections.id, connection.id))
      .limit(1);

    if (!dbConn) throw new Error(`Connection ${connection.id} not found`);

    const creds = dbConn.credentialsEncrypted as unknown as PlaidCredentials;
    const plaid = getPlaidClient();

    let cursor = dbConn.syncCursor ?? undefined;
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: string[] = [];
    let hasMore = true;

    while (hasMore) {
      const response = await plaid.transactionsSync({
        access_token: creds.accessToken,
        cursor,
      });
      added.push(...response.data.added);
      modified.push(...response.data.modified);
      removed.push(...response.data.removed.map((r) => r.transaction_id));
      hasMore = response.data.has_more;
      cursor = response.data.next_cursor;
    }

    // Build account_id → account_name map
    const accountsResponse = await plaid.accountsGet({
      access_token: creds.accessToken,
    });
    const accountMap = new Map<string, string>();
    for (const acc of accountsResponse.data.accounts) {
      accountMap.set(acc.account_id, acc.name);
    }

    // Normalize + upsert added transactions
    for (const tx of added) {
      if (tx.pending) continue; // Skip pending transactions

      await db
        .insert(financeTransactions)
        .values({
          agentInstanceId: dbConn.agentInstanceId,
          dataSourceConnectionId: dbConn.id,
          transactionDate: tx.date,
          description: tx.name,
          merchantName: tx.merchant_name ?? null,
          amount: tx.amount.toString(),
          category: tx.personal_finance_category?.primary ?? null,
          accountName: accountMap.get(tx.account_id) ?? null,
          source: "plaid",
          plaidTransactionId: tx.transaction_id,
          rawData: tx as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing();
    }

    // Apply modifications
    for (const tx of modified) {
      await db
        .update(financeTransactions)
        .set({
          description: tx.name,
          merchantName: tx.merchant_name ?? null,
          amount: tx.amount.toString(),
          category: tx.personal_finance_category?.primary ?? null,
        })
        .where(eq(financeTransactions.plaidTransactionId, tx.transaction_id));
    }

    // Apply removals
    for (const txId of removed) {
      await db
        .delete(financeTransactions)
        .where(eq(financeTransactions.plaidTransactionId, txId));
    }

    // Persist the new cursor
    await db
      .update(dataSourceConnections)
      .set({
        syncCursor: cursor,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dataSourceConnections.id, dbConn.id));

    console.log(
      `[PlaidAdapter] Synced: +${added.length} added, ~${modified.length} modified, -${removed.length} removed`,
    );

    return added.map((tx) => ({ ...tx })) as unknown as NormalizedData[];
  },

  async handleWebhook(payload: unknown) {
    const body = payload as { webhook_type?: string; webhook_code?: string; item_id?: string };

    // For SYNC_UPDATES_AVAILABLE, find the connection by item_id and queue a sync
    if (body.webhook_code === "SYNC_UPDATES_AVAILABLE" && body.item_id) {
      // Look up the connection
      const conns = await db.select().from(dataSourceConnections);
      const conn = conns.find((c) => {
        const creds = c.credentialsEncrypted as PlaidCredentials | null;
        return creds?.itemId === body.item_id;
      });

      if (conn) {
        return { connectionId: conn.id, action: "sync" as const };
      }
    }

    return { connectionId: "", action: "none" as const };
  },
};
