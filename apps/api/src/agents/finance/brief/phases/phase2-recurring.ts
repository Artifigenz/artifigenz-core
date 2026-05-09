import { eq, and } from "drizzle-orm";
import {
  db,
  dataSourceConnections,
  financeRecurringStreams,
  financeAccounts,
} from "@artifigenz/db";
import { TransactionStreamStatus, type TransactionStream } from "plaid";
import { getPlaidClient } from "../../lib/plaid-client";
import { categorizeRecurringStreams } from "../../lib/merchant-categorizer";
import type { DigestStream } from "../helpers/types";

interface PlaidCredentials {
  accessToken: string;
  itemId: string;
}

const KEEP_STATUSES: string[] = [
  TransactionStreamStatus.Mature,
  TransactionStreamStatus.EarlyDetection,
];

function toDigestStream(
  s: TransactionStream,
  direction: "inflow" | "outflow",
): DigestStream {
  return {
    plaidStreamId: s.stream_id,
    direction,
    plaidAccountId: s.account_id,
    merchantName: s.merchant_name,
    description: s.description,
    averageAmount: s.average_amount.amount ?? 0,
    frequency: s.frequency,
    lastDate: s.last_date,
    predictedNextDate: s.predicted_next_date ?? null,
    firstDate: s.first_date,
    status: s.status,
    pfcPrimary: s.personal_finance_category?.primary ?? null,
  };
}

/**
 * Phase 2 — Fetch recurring inflow and outflow streams from Plaid for every
 * connected item, keep only MATURE + EARLY_DETECTION, and replace the cached
 * rows in finance_recurring_streams for this agent instance. Spec §3.3.
 */
export async function phase2FetchRecurring(
  agentInstanceId: string,
): Promise<{ inflow: DigestStream[]; outflow: DigestStream[] }> {
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
  const inflow: DigestStream[] = [];
  const outflow: DigestStream[] = [];

  for (const conn of connections) {
    const creds = conn.credentialsEncrypted as unknown as PlaidCredentials | null;
    if (!creds?.accessToken) continue;

    let response;
    try {
      response = await plaid.transactionsRecurringGet({
        access_token: creds.accessToken,
      });
    } catch (err) {
      const data = (err as { response?: { data?: { error_code?: string; error_message?: string } } })
        .response?.data;
      console.warn(
        `[Phase2] Skipping connection ${conn.id}: ${data?.error_code ?? "unknown"} — ${data?.error_message ?? String(err)}`,
      );
      continue;
    }

    for (const s of response.data.inflow_streams) {
      if (KEEP_STATUSES.includes(s.status)) inflow.push(toDigestStream(s, "inflow"));
    }
    for (const s of response.data.outflow_streams) {
      if (KEEP_STATUSES.includes(s.status)) outflow.push(toDigestStream(s, "outflow"));
    }
  }

  // Get current stream IDs from Plaid to detect removed streams
  const currentPlaidStreamIds = new Set(
    [...inflow, ...outflow].map((s) => s.plaidStreamId)
  );

  // Get existing streams to detect removals
  const existingStreams = await db
    .select({ id: financeRecurringStreams.id, plaidStreamId: financeRecurringStreams.plaidStreamId })
    .from(financeRecurringStreams)
    .where(eq(financeRecurringStreams.agentInstanceId, agentInstanceId));

  // Delete streams that no longer exist in Plaid (cancelled subscriptions, etc.)
  const toDelete = existingStreams.filter(
    (s) => !currentPlaidStreamIds.has(s.plaidStreamId)
  );
  for (const stream of toDelete) {
    await db
      .delete(financeRecurringStreams)
      .where(eq(financeRecurringStreams.id, stream.id));
  }

  // Upsert streams — preserving existing category data if already set
  for (const s of [...inflow, ...outflow]) {
    await db
      .insert(financeRecurringStreams)
      .values({
        agentInstanceId,
        plaidStreamId: s.plaidStreamId,
        direction: s.direction,
        plaidAccountId: s.plaidAccountId,
        merchantName: s.merchantName,
        description: s.description,
        averageAmount: s.averageAmount.toString(),
        frequency: s.frequency,
        lastDate: s.lastDate,
        predictedNextDate: s.predictedNextDate,
        firstDate: s.firstDate,
        status: s.status,
        pfcPrimary: s.pfcPrimary,
      })
      .onConflictDoUpdate({
        target: [
          financeRecurringStreams.agentInstanceId,
          financeRecurringStreams.plaidStreamId,
        ],
        set: {
          // Update the fields from Plaid (amounts, dates, etc.)
          direction: s.direction,
          plaidAccountId: s.plaidAccountId,
          merchantName: s.merchantName,
          description: s.description,
          averageAmount: s.averageAmount.toString(),
          frequency: s.frequency,
          lastDate: s.lastDate,
          predictedNextDate: s.predictedNextDate,
          firstDate: s.firstDate,
          status: s.status,
          pfcPrimary: s.pfcPrimary,
          updatedAt: new Date(),
          // Note: category, categorySource, categoryConfidence are NOT updated
          // This preserves LLM-learned or user-overridden categories
        },
      });
  }

  // Now fetch all streams that need categorization and run the categorizer
  const allStreams = await db
    .select()
    .from(financeRecurringStreams)
    .where(eq(financeRecurringStreams.agentInstanceId, agentInstanceId));

  // Get account type info for better categorization context
  const accounts = await db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, agentInstanceId));

  const accountTypeMap = new Map(
    accounts.map((a) => [a.plaidAccountId, a.type])
  );

  // Prepare streams for categorization
  const streamsForCategorization = allStreams.map((s) => ({
    id: s.id,
    merchantName: s.merchantName,
    description: s.description,
    averageAmount: s.averageAmount,
    frequency: s.frequency,
    pfcPrimary: s.pfcPrimary,
    direction: s.direction,
    category: s.category,
    accountType: s.plaidAccountId ? accountTypeMap.get(s.plaidAccountId) : null,
  }));

  // Run categorization (will use cache for known merchants, LLM for unknowns)
  const uncategorizedCount = streamsForCategorization.filter(
    (s) => !s.category && s.direction === "outflow"
  ).length;

  if (uncategorizedCount > 0) {
    console.log(`[Phase2] Running categorization for ${uncategorizedCount} uncategorized streams`);
    await categorizeRecurringStreams(streamsForCategorization);
  }

  return { inflow, outflow };
}
