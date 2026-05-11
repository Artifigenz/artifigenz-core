import { eq } from "drizzle-orm";
import { CountryCode, Products } from "plaid";
import {
  db,
  dataSourceConnections,
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
import { ingestPlaidConnection } from "../ingest/plaid-ingest";

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
   * `redirectUri` enables OAuth banks (Chase, Capital One, BoA, Wells Fargo, Citi)
   * and must match a URL registered in the Plaid dashboard.
   */
  async getConnectionConfig(
    agentInstanceId: string,
    options?: { redirectUri?: string; institutionId?: string },
  ) {
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
    // days_requested controls how far back Plaid backfills history on initial
    // pull. Default is ~30 days, which gives the LLM almost nothing to detect
    // recurring patterns from. 730 is the Plaid maximum.
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Artifigenz",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca],
      language: "en",
      transactions: { days_requested: 730 },
      ...(options?.redirectUri ? { redirect_uri: options.redirectUri } : {}),
      ...(options?.institutionId ? { institution_id: options.institutionId } : {}),
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
      .returning({
        id: dataSourceConnections.id,
        agentInstanceId: dataSourceConnections.agentInstanceId,
        dataSourceTypeId: dataSourceConnections.dataSourceTypeId,
        displayName: dataSourceConnections.displayName,
        status: dataSourceConnections.status,
      });

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
   * Sync delegates to ingest/plaid-ingest which:
   *   - upserts finance_accounts via (institution + last4) identity
   *   - cursor-syncs Plaid transactions with dedup
   * Returns a synthetic array sized by inserted-count so the sync worker
   * logs a meaningful number.
   */
  async sync(connection): Promise<NormalizedData[]> {
    try {
      const result = await ingestPlaidConnection(connection.id);
      console.log(
        `[PlaidAdapter] Ingest: +${result.transactionsInserted} new, ` +
          `${result.transactionsSkipped} dedup-skipped, ` +
          `~${result.transactionsModified} modified, ` +
          `-${result.transactionsRemoved} removed, ` +
          `${result.accountsUpserted} accounts`,
      );
      // Return an array of the right length for downstream record counting.
      return Array.from({ length: result.transactionsInserted }, () => ({}) as NormalizedData);
    } catch (err) {
      const plaidError = (err as { response?: { data?: {
        error_code?: string;
        error_message?: string;
      } } }).response?.data;

      const errorCode = plaidError?.error_code;
      const errorMessage = plaidError?.error_message ?? (err instanceof Error ? err.message : "Sync failed");
      const requiresReauth = errorCode === "ITEM_LOGIN_REQUIRED" ||
        errorCode === "INVALID_ACCESS_TOKEN" ||
        errorCode === "ITEM_LOCKED";

      await db
        .update(dataSourceConnections)
        .set({
          lastSyncStatus: "error",
          lastSyncError: errorMessage,
          requiresReauth,
          updatedAt: new Date(),
        })
        .where(eq(dataSourceConnections.id, connection.id));

      console.error(`[PlaidAdapter] Sync failed (${errorCode ?? "?"}): ${errorMessage}`);
      throw err;
    }
  },

  async handleWebhook(payload: unknown) {
    const body = payload as { webhook_type?: string; webhook_code?: string; item_id?: string };

    // For SYNC_UPDATES_AVAILABLE, find the connection by item_id and queue a sync
    if (body.webhook_code === "SYNC_UPDATES_AVAILABLE" && body.item_id) {
      // Look up the connection (select only columns we need)
      const conns = await db
        .select({
          id: dataSourceConnections.id,
          credentialsEncrypted: dataSourceConnections.credentialsEncrypted,
        })
        .from(dataSourceConnections);
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
