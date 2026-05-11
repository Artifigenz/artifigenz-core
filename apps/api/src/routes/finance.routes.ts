import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  agentInstances,
  financeTransactions,
  financeAccounts,
  financeBriefs,
  financeInsights,
  merchantClusters,
  fileUploads,
  dataSourceConnections,
  insights,
  agentInstanceSkills,
} from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import {
  categorizeAgentInstance,
  backfillOrphans,
} from "../agents/finance/categorize";

const app = new Hono();
app.use("/*", clerkAuth);

/**
 * POST /api/finance/categorize
 *   Runs LLM classification over all transactions for the user's finance
 *   agent. Idempotent: clusters whose latest txn is already analyzed are
 *   skipped. Returns counts so the caller can show progress.
 *
 *   This is the step-3 entry point of the unified-finance rewrite. It
 *   populates merchant_clusters and backfills
 *   finance_transactions.{category, is_recurring, merchant_cluster_id}.
 */
app.post("/categorize", async (c) => {
  const user = c.get("user");

  const [instance] = await db
    .select({ id: agentInstances.id, status: agentInstances.status })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .orderBy(agentInstances.createdAt)
    .limit(1);

  if (!instance) {
    return c.json({ error: "No finance agent found." }, 400);
  }
  if (instance.status === "inactive") {
    return c.json({ error: "Finance agent is inactive." }, 400);
  }

  try {
    const result = await categorizeAgentInstance(instance.id);
    const orphans = await backfillOrphans(instance.id);
    return c.json({ ...result, orphansBackfilled: orphans });
  } catch (err) {
    console.error("[finance/categorize] failed:", err);
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

/**
 * GET /api/finance/transactions
 *   Returns every consolidated transaction for the user's finance agent —
 *   the source-of-truth table that the breakdown page renders. Joins
 *   finance_transactions with finance_accounts so each row carries its
 *   institution + last4. Sorted newest first.
 */
app.get("/transactions", async (c) => {
  const user = c.get("user");

  const [instance] = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .orderBy(agentInstances.createdAt)
    .limit(1);

  if (!instance) return c.json({ error: "No finance agent found" }, 404);

  const rows = await db
    .select({
      id: financeTransactions.id,
      date: financeTransactions.transactionDate,
      description: financeTransactions.description,
      merchantName: financeTransactions.merchantName,
      merchantNormalized: financeTransactions.merchantNormalized,
      amount: financeTransactions.amount,
      source: financeTransactions.source,
      category: financeTransactions.category,
      isRecurring: financeTransactions.isRecurring,
      accountName: financeAccounts.name,
      institutionName: financeAccounts.institutionName,
      accountLast4: financeAccounts.accountLast4,
    })
    .from(financeTransactions)
    .leftJoin(financeAccounts, eq(financeAccounts.id, financeTransactions.accountId))
    .where(eq(financeTransactions.agentInstanceId, instance.id))
    .orderBy(desc(financeTransactions.transactionDate));

  let income = 0;
  let expenses = 0;
  for (const r of rows) {
    const amt = parseFloat(r.amount);
    // Sign convention: positive = money out, negative = money in.
    if (amt < 0) income += -amt;
    else expenses += amt;
  }

  return c.json({
    count: rows.length,
    totals: {
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      net: Math.round((income - expenses) * 100) / 100,
    },
    transactions: rows.map((r) => ({
      ...r,
      amount: parseFloat(r.amount),
    })),
  });
});

/**
 * POST /api/finance/wipe
 *   Devtools: nuke all finance data and connections for the caller, including
 *   the agent_instance itself, so the next page load starts onboarding from
 *   zero. Plaid OAuth tokens are deleted (you'll re-link banks).
 *
 *   Returns counts of what was removed.
 */
app.post("/wipe", async (c) => {
  const user = c.get("user");

  const instances = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    );

  if (instances.length === 0) {
    return c.json({
      success: true,
      message: "No finance agent to wipe.",
      removed: {},
    });
  }

  const instanceIds = instances.map((i) => i.id);

  // Order matters: delete children before parents. Most tables cascade from
  // agent_instances, but we delete explicitly so we can return counts.
  const accountsDel = await db
    .delete(financeAccounts)
    .where(inArray(financeAccounts.agentInstanceId, instanceIds))
    .returning({ id: financeAccounts.id });
  const txsDel = await db
    .delete(financeTransactions)
    .where(inArray(financeTransactions.agentInstanceId, instanceIds))
    .returning({ id: financeTransactions.id });
  const clustersDel = await db
    .delete(merchantClusters)
    .where(inArray(merchantClusters.agentInstanceId, instanceIds))
    .returning({ id: merchantClusters.id });
  const briefsDel = await db
    .delete(financeBriefs)
    .where(inArray(financeBriefs.agentInstanceId, instanceIds))
    .returning({ id: financeBriefs.id });
  const financeInsightsDel = await db
    .delete(financeInsights)
    .where(inArray(financeInsights.agentInstanceId, instanceIds))
    .returning({ id: financeInsights.id });
  const platformInsightsDel = await db
    .delete(insights)
    .where(inArray(insights.agentInstanceId, instanceIds))
    .returning({ id: insights.id });
  const uploadsDel = await db
    .delete(fileUploads)
    .where(
      inArray(
        fileUploads.dataSourceConnectionId,
        db
          .select({ id: dataSourceConnections.id })
          .from(dataSourceConnections)
          .where(inArray(dataSourceConnections.agentInstanceId, instanceIds)),
      ),
    )
    .returning({ id: fileUploads.id });
  const connsDel = await db
    .delete(dataSourceConnections)
    .where(inArray(dataSourceConnections.agentInstanceId, instanceIds))
    .returning({ id: dataSourceConnections.id });
  const skillsDel = await db
    .delete(agentInstanceSkills)
    .where(inArray(agentInstanceSkills.agentInstanceId, instanceIds))
    .returning({ id: agentInstanceSkills.id });
  const instancesDel = await db
    .delete(agentInstances)
    .where(inArray(agentInstances.id, instanceIds))
    .returning({ id: agentInstances.id });

  console.log(
    `[finance/wipe] user ${user.id}: removed instance(s) ${instanceIds.join(", ")}`,
  );

  return c.json({
    success: true,
    message: "Finance agent wiped. Refresh to start onboarding fresh.",
    removed: {
      agentInstances: instancesDel.length,
      connections: connsDel.length,
      accounts: accountsDel.length,
      transactions: txsDel.length,
      merchantClusters: clustersDel.length,
      briefs: briefsDel.length,
      financeInsights: financeInsightsDel.length,
      platformInsights: platformInsightsDel.length,
      fileUploads: uploadsDel.length,
      agentInstanceSkills: skillsDel.length,
    },
  });
});

export default app;
