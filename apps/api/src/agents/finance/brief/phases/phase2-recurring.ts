import { eq, and } from "drizzle-orm";
import {
  db,
  dataSourceConnections,
  financeRecurringStreams,
} from "@artifigenz/db";
import { TransactionStreamStatus, type TransactionStream } from "plaid";
import { getPlaidClient } from "../../lib/plaid-client";
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
  const connections = await db
    .select()
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

  // Replace all cached streams for this agent instance.
  await db
    .delete(financeRecurringStreams)
    .where(eq(financeRecurringStreams.agentInstanceId, agentInstanceId));

  const rows = [...inflow, ...outflow].map((s) => ({
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
  }));

  if (rows.length > 0) {
    await db.insert(financeRecurringStreams).values(rows);
  }

  return { inflow, outflow };
}
