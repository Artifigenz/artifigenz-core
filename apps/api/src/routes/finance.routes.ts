import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  agentInstances,
  financeTransactions,
  financeAccounts,
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

export default app;
