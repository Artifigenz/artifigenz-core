import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  financeTransactions,
  merchantClusters,
} from "@artifigenz/db";
import {
  buildClusters,
  loadAccountContext,
  type MerchantCluster,
} from "./build-clusters";
import { classifyCluster, type ClassificationResult } from "./llm-classify";

export interface CategorizeResult {
  clustersAnalyzed: number;
  clustersSkippedCached: number;
  txnsBackfilled: number;
  errors: Array<{ merchant: string; error: string }>;
}

const CONCURRENCY = 8;

/**
 * Run classification for an agent_instance.
 *
 * Idempotent: clusters already in merchant_clusters with up-to-date analyzed_at
 * (relative to their latest_txn_date in the cluster) are skipped. New txns in
 * an existing cluster trigger a re-analysis so the LLM can refine
 * is_recurring/cadence/monthly_amount.
 */
export async function categorizeAgentInstance(
  agentInstanceId: string,
): Promise<CategorizeResult> {
  const clusters = await buildClusters(agentInstanceId);
  const accounts = await loadAccountContext(agentInstanceId);

  const existing = await db
    .select({
      id: merchantClusters.id,
      merchantNormalized: merchantClusters.merchantNormalized,
      lastSeenDate: merchantClusters.lastSeenDate,
      analyzedAt: merchantClusters.analyzedAt,
    })
    .from(merchantClusters)
    .where(eq(merchantClusters.agentInstanceId, agentInstanceId));
  const existingMap = new Map(existing.map((e) => [e.merchantNormalized, e]));

  const toAnalyze: MerchantCluster[] = [];
  let skippedCached = 0;

  for (const c of clusters) {
    const prev = existingMap.get(c.merchantNormalized);
    if (
      prev &&
      prev.analyzedAt &&
      prev.lastSeenDate &&
      prev.lastSeenDate >= c.lastSeenDate
    ) {
      skippedCached++;
      continue;
    }
    toAnalyze.push(c);
  }

  const errors: CategorizeResult["errors"] = [];
  let txnsBackfilled = 0;
  let analyzed = 0;

  for (let i = 0; i < toAnalyze.length; i += CONCURRENCY) {
    const batch = toAnalyze.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (cluster) => {
        const result = await classifyCluster(cluster, accounts);
        return { cluster, result };
      }),
    );

    for (const r of results) {
      if (r.status === "rejected") {
        errors.push({
          merchant: "(unknown)",
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
        continue;
      }
      const { cluster, result } = r.value;
      try {
        const inserted = await upsertClusterAndBackfill(
          agentInstanceId,
          cluster,
          result,
        );
        analyzed++;
        txnsBackfilled += inserted;
      } catch (err) {
        errors.push({
          merchant: cluster.merchantNormalized,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    clustersAnalyzed: analyzed,
    clustersSkippedCached: skippedCached,
    txnsBackfilled,
    errors,
  };
}

async function upsertClusterAndBackfill(
  agentInstanceId: string,
  cluster: MerchantCluster,
  result: ClassificationResult,
): Promise<number> {
  const now = new Date();
  const [row] = await db
    .insert(merchantClusters)
    .values({
      agentInstanceId,
      merchantNormalized: cluster.merchantNormalized,
      displayName: cluster.displayName,
      category: result.category,
      isRecurring: result.isRecurring,
      cadence: result.cadence,
      monthlyAmount: result.monthlyAmount.toFixed(2),
      txnCount: cluster.txnCount,
      totalAmount: cluster.totalAmount.toFixed(2),
      firstSeenDate: cluster.firstSeenDate,
      lastSeenDate: cluster.lastSeenDate,
      confidence: result.confidence.toFixed(2),
      reasoning: result.reasoning,
      analyzedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        merchantClusters.agentInstanceId,
        merchantClusters.merchantNormalized,
      ],
      set: {
        displayName: cluster.displayName,
        category: result.category,
        isRecurring: result.isRecurring,
        cadence: result.cadence,
        monthlyAmount: result.monthlyAmount.toFixed(2),
        txnCount: cluster.txnCount,
        totalAmount: cluster.totalAmount.toFixed(2),
        firstSeenDate: cluster.firstSeenDate,
        lastSeenDate: cluster.lastSeenDate,
        confidence: result.confidence.toFixed(2),
        reasoning: result.reasoning,
        analyzedAt: now,
        updatedAt: now,
      },
    })
    .returning({ id: merchantClusters.id });

  const clusterId = row.id;

  const txIds = cluster.txns.map((t) => t.id);
  if (txIds.length === 0) return 0;

  const updated = await db
    .update(financeTransactions)
    .set({
      category: result.category,
      isRecurring: result.isRecurring,
      merchantClusterId: clusterId,
    })
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        inArray(financeTransactions.id, txIds),
      ),
    )
    .returning({ id: financeTransactions.id });

  return updated.length;
}

/**
 * Mark any transaction that didn't match a cluster (orphans) as miscellaneous.
 * Should be rare — only fires if a transaction has no merchant_normalized.
 */
export async function backfillOrphans(agentInstanceId: string): Promise<number> {
  const updated = await db
    .update(financeTransactions)
    .set({ category: "miscellaneous", isRecurring: false })
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        isNull(financeTransactions.category),
      ),
    )
    .returning({ id: financeTransactions.id });
  return updated.length;
}
