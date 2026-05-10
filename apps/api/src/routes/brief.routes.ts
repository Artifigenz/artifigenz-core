import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  agentInstances,
  financeBriefs,
  financeAccounts,
  financeTransactions,
  merchantClusters,
  dataSourceConnections,
} from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import {
  createGeneration,
  isClosed,
  subscribe,
  type BriefEvent,
} from "../agents/finance/brief/events";
import { generateAndStoreBrief } from "../agents/finance/aggregate";
import {
  categorizeAgentInstance,
  backfillOrphans,
} from "../agents/finance/categorize";
import { CATEGORIES, type Category } from "../agents/finance/categorize/llm-classify";

const app = new Hono();
app.use("/*", clerkAuth);

// ─── Brief generation ──────────────────────────────────────────────

app.post("/generate", async (c) => {
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
    return c.json({ error: "No finance agent found. Complete onboarding first." }, 400);
  }
  if (instance.status === "inactive") {
    return c.json({ error: "Finance agent is inactive." }, 400);
  }

  const generationId = randomUUID();
  createGeneration(generationId);

  generateAndStoreBrief(user.id, instance.id, generationId).catch((err) => {
    console.error(`[Brief] generation ${generationId} failed:`, err);
  });

  return c.json({ generation_id: generationId });
});

app.get("/generate/:id/events", async (c) => {
  const generationId = c.req.param("id");

  return streamSSE(c, async (stream) => {
    await new Promise<void>((resolve) => {
      const unsubscribe = subscribe(generationId, (event: BriefEvent) => {
        stream
          .writeSSE({ event: event.type, data: JSON.stringify(event) })
          .then(() => {
            if (
              event.type === "complete" ||
              event.type === "error" ||
              event.type === "insufficient_data"
            ) {
              unsubscribe();
              resolve();
            }
          })
          .catch((err) => {
            console.error("[Brief/sse] write failed:", err);
            unsubscribe();
            resolve();
          });
      });
      if (isClosed(generationId)) {
        unsubscribe();
        resolve();
      }
    });
  });
});

// ─── Brief read ────────────────────────────────────────────────────

interface CategoryTotal {
  monthly: number;
  txnCount: number;
  activeClusterCount?: number;
  topMerchants: Array<{ merchant: string; monthly: number; cadence: string | null }>;
}

interface DigestSnapshot {
  incomeMonthly?: number;
  expensesMonthly?: number;
  leftoverMonthly?: number;
  categoryTotals?: Record<Category, CategoryTotal>;
}

function homeSummary(digest: DigestSnapshot | null) {
  const empty = { income: 0, outflow: 0, leftover: 0, breakdown: [] as Array<{
    id: string; label: string; sublabel: string; amount: number; count?: number;
  }> };
  if (!digest) return empty;

  const totals = digest.categoryTotals;
  if (!totals) return empty;

  const breakdown = [];

  const sub = totals.subscription;
  const subActive = sub?.activeClusterCount ?? 0;
  if (sub && subActive > 0) {
    breakdown.push({
      id: "subscriptions",
      label: "Subscriptions",
      sublabel: `${subActive} active`,
      amount: sub.monthly,
      count: subActive,
    });
  }

  const loan = totals.loan_emi;
  const loanActive = loan?.activeClusterCount ?? 0;
  if (loan && loanActive > 0) {
    breakdown.push({
      id: "loans",
      label: "Loans & EMI",
      sublabel: `${loanActive} ${loanActive === 1 ? "line" : "lines"}`,
      amount: loan.monthly,
      count: loanActive,
    });
  }

  const variable = totals.variable_recurring;
  const varActive = variable?.activeClusterCount ?? 0;
  if (variable && varActive > 0) {
    breakdown.push({
      id: "variable",
      label: "Variable recurring",
      sublabel: "utilities, phone, insurance",
      amount: variable.monthly,
      count: varActive,
    });
  }

  const fees = totals.fee_interest;
  const feesActive = fees?.activeClusterCount ?? 0;
  if (fees && feesActive > 0) {
    breakdown.push({
      id: "fees",
      label: "Fees & interest",
      sublabel: `${feesActive} ${feesActive === 1 ? "charge" : "charges"}`,
      amount: fees.monthly,
      count: feesActive,
    });
  }

  return {
    income: digest.incomeMonthly ?? 0,
    outflow: digest.expensesMonthly ?? 0,
    leftover: digest.leftoverMonthly ?? 0,
    breakdown,
  };
}

app.get("/current", async (c) => {
  const user = c.get("user");

  const [row] = await db
    .select()
    .from(financeBriefs)
    .where(eq(financeBriefs.userId, user.id))
    .orderBy(desc(financeBriefs.generatedAt))
    .limit(1);

  if (!row) return c.json({ error: "No brief yet" }, 404);

  return c.json({
    id: row.id,
    verdict: row.verdict,
    numbers: row.numbers,
    paragraph: row.paragraph,
    summary: homeSummary(row.digestSnapshot as DigestSnapshot | null),
    data_scope: row.dataScope,
    generated_at: row.generatedAt,
  });
});

// ─── Breakdown ─────────────────────────────────────────────────────

const FREQUENCY_MAP: Record<string, string> = {
  monthly: "MONTHLY",
  weekly: "WEEKLY",
  biweekly: "BIWEEKLY",
  quarterly: "QUARTERLY",
  annual: "ANNUALLY",
  irregular: "MONTHLY",
  one_time: "MONTHLY",
};

// Map our 7 categories onto the breakdown UI's existing section keys so the
// frontend's existing layout keeps working. Sections that don't have a 1:1
// match (rent / utilities / insurance) come back empty — the UI hides empty
// sections.
const CATEGORY_TO_SECTION: Record<Category, string> = {
  income: "income",
  subscription: "subscriptions",
  loan_emi: "loans",
  fee_interest: "fees",
  variable_recurring: "variable",
  internal_transfer: "transfersOut",
  miscellaneous: "other",
};

app.get("/breakdown", async (c) => {
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

  const [brief] = await db
    .select()
    .from(financeBriefs)
    .where(eq(financeBriefs.userId, user.id))
    .orderBy(desc(financeBriefs.generatedAt))
    .limit(1);

  if (!brief) return c.json({ error: "No brief yet" }, 404);

  const allClusters = await db
    .select()
    .from(merchantClusters)
    .where(eq(merchantClusters.agentInstanceId, instance.id));

  // Hide recurring clusters that haven't seen activity in 60+ days so the
  // breakdown matches the home card. Non-recurring clusters and recent ones
  // pass through. Cancelled subscriptions still live in the DB for audit.
  const STALE_DAYS = 60;
  const todayMs = Date.now();
  const isStale = (lastSeen: string | null) => {
    if (!lastSeen) return true;
    const last = new Date(lastSeen + "T00:00:00Z").getTime();
    return (todayMs - last) / 86400000 > STALE_DAYS;
  };
  const clusters = allClusters.filter(
    (c) => !c.isRecurring || !isStale(c.lastSeenDate),
  );

  const accounts = await db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, instance.id));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // For each cluster, find its dominant account (the one with the most txns
  // in that cluster) so the UI can show "TD Chequing ••9165".
  const dominantAccount = new Map<string, string>();
  const txAccounts = await db
    .select({
      clusterId: financeTransactions.merchantClusterId,
      accountId: financeTransactions.accountId,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, instance.id));
  const counts = new Map<string, Map<string, number>>();
  for (const t of txAccounts) {
    if (!t.clusterId || !t.accountId) continue;
    if (!counts.has(t.clusterId)) counts.set(t.clusterId, new Map());
    const inner = counts.get(t.clusterId)!;
    inner.set(t.accountId, (inner.get(t.accountId) ?? 0) + 1);
  }
  for (const [clusterId, inner] of counts) {
    let max = 0;
    let winner = "";
    for (const [accId, c] of inner) {
      if (c > max) {
        max = c;
        winner = accId;
      }
    }
    if (winner) dominantAccount.set(clusterId, winner);
  }

  // Frontend's section keys (kept stable so the existing UI keeps working).
  const sections: Record<string, { total: number; count: number; items: Array<Record<string, unknown>> }> = {
    income: { total: 0, count: 0, items: [] },
    transfersIn: { total: 0, count: 0, items: [] },
    transfersOut: { total: 0, count: 0, items: [] },
    subscriptions: { total: 0, count: 0, items: [] },
    loans: { total: 0, count: 0, items: [] },
    fees: { total: 0, count: 0, items: [] },
    rent: { total: 0, count: 0, items: [] },
    utilities: { total: 0, count: 0, items: [] },
    insurance: { total: 0, count: 0, items: [] },
    variable: { total: 0, count: 0, items: [] },
    other: { total: 0, count: 0, items: [] },
  };

  for (const c of clusters) {
    const cat = c.category as Category;
    if (!CATEGORIES.includes(cat)) continue;

    let sectionKey = CATEGORY_TO_SECTION[cat];
    // Internal transfers split by sign: net positive total = money out
    // (transfersOut), net negative total = money in (transfersIn).
    if (cat === "internal_transfer") {
      const totalAmount = parseFloat(c.totalAmount ?? "0");
      sectionKey = totalAmount >= 0 ? "transfersOut" : "transfersIn";
    }

    const monthly = parseFloat(c.monthlyAmount ?? "0");
    const accId = dominantAccount.get(c.id) ?? null;
    const acct = accId ? accountById.get(accId) : null;

    sections[sectionKey].total += monthly;
    sections[sectionKey].count += 1;
    sections[sectionKey].items.push({
      id: c.id,
      merchantName: c.displayName ?? c.merchantNormalized,
      description: c.reasoning,
      amount: parseFloat(c.totalAmount ?? "0"),
      monthlyAmount: Math.round(monthly * 100) / 100,
      frequency: FREQUENCY_MAP[c.cadence ?? "irregular"] ?? "MONTHLY",
      lastDate: c.lastSeenDate,
      nextDate: null,
      accountId: accId,
      accountName: acct?.name ?? null,
      accountMask: acct?.accountLast4 ?? acct?.mask ?? null,
      category: c.category,
      categoryConfidence: c.confidence ? parseFloat(c.confidence) : null,
      pfcPrimary: null,
    });
  }

  // Round each section's total
  for (const k of Object.keys(sections)) {
    sections[k].total = Math.round(sections[k].total * 100) / 100;
  }

  const incomeTotal = sections.income.total;
  const fixedRecurring =
    sections.subscriptions.total +
    sections.loans.total +
    sections.fees.total;
  const variableRecurring = sections.variable.total;
  const recurringOutflow = fixedRecurring + variableRecurring + sections.other.total;

  const digest = brief.digestSnapshot as { expensesMonthly?: number } | null;
  const totalExpenses = digest?.expensesMonthly ?? recurringOutflow;
  const leftover = incomeTotal - totalExpenses;

  // Connection diagnostics — show health of each ingestion source
  const connections = await db
    .select({
      id: dataSourceConnections.id,
      dataSourceTypeId: dataSourceConnections.dataSourceTypeId,
      displayName: dataSourceConnections.displayName,
      status: dataSourceConnections.status,
      lastSyncedAt: dataSourceConnections.lastSyncedAt,
    })
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.agentInstanceId, instance.id));

  return c.json({
    generatedAt: brief.generatedAt,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      mask: a.accountLast4 ?? a.mask,
      type: a.type,
      subtype: a.subtype,
      currentBalance: a.currentBalance ? parseFloat(a.currentBalance) : 0,
      availableBalance: a.availableBalance ? parseFloat(a.availableBalance) : null,
      currency: a.isoCurrencyCode,
    })),
    ...sections,
    totals: {
      income: Math.round(incomeTotal * 100) / 100,
      fixedRecurring: Math.round(fixedRecurring * 100) / 100,
      variableRecurring: Math.round(variableRecurring * 100) / 100,
      recurringOutflow: Math.round(recurringOutflow * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      leftover: Math.round(leftover * 100) / 100,
    },
    diagnostics: {
      connections: connections.map((conn) => ({
        id: conn.id,
        institution: conn.displayName ?? conn.dataSourceTypeId,
        status: conn.status,
        accountCount: accounts.filter(
          (a) => a.dataSourceConnectionId === conn.id,
        ).length,
        streamCount: clusters.filter((cl) => {
          const accId = dominantAccount.get(cl.id);
          if (!accId) return false;
          const acct = accountById.get(accId);
          return acct?.dataSourceConnectionId === conn.id;
        }).length,
        lastSynced: conn.lastSyncedAt,
      })),
      totalStreams: clusters.length,
      streamsByAccount: accounts.map((a) => ({
        account: `${a.name ?? "(account)"} ••${a.accountLast4 ?? a.mask ?? "?"}`,
        streams: clusters.filter((cl) => dominantAccount.get(cl.id) === a.id)
          .length,
      })),
    },
  });
});

// ─── Categorization controls ───────────────────────────────────────

/**
 * POST /api/brief/categories/reset
 *   Clears all merchant_clusters categorization for the user's finance agent
 *   and re-runs the LLM classifier. Used after the user changes their
 *   categorization rules or wants a fresh take.
 */
app.post("/categories/reset", async (c) => {
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

  await db
    .update(merchantClusters)
    .set({ analyzedAt: null })
    .where(eq(merchantClusters.agentInstanceId, instance.id));

  // Re-run categorization synchronously (caller is asking for a fresh take).
  const result = await categorizeAgentInstance(instance.id);
  await backfillOrphans(instance.id);

  return c.json({
    success: true,
    message: `Re-categorized ${result.clustersAnalyzed} merchant cluster(s).`,
    ...result,
  });
});

/**
 * PATCH /api/brief/streams/:streamId/category
 *   Manually override a merchant cluster's category. The `streamId` is the
 *   merchant_cluster id surfaced by /breakdown. Updates the cluster and
 *   backfills finance_transactions.category for that cluster's transactions.
 */
app.patch("/streams/:streamId/category", async (c) => {
  const user = c.get("user");
  const clusterId = c.req.param("streamId");
  const body = await c.req.json<{ category: string }>();

  if (!body.category || !(CATEGORIES as readonly string[]).includes(body.category)) {
    return c.json(
      { error: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}` },
      400,
    );
  }
  const category = body.category as Category;

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

  const [cluster] = await db
    .select()
    .from(merchantClusters)
    .where(
      and(
        eq(merchantClusters.id, clusterId),
        eq(merchantClusters.agentInstanceId, instance.id),
      ),
    );

  if (!cluster) return c.json({ error: "Cluster not found" }, 404);

  await db
    .update(merchantClusters)
    .set({
      category,
      confidence: "1.00",
      reasoning: "User override",
      updatedAt: new Date(),
    })
    .where(eq(merchantClusters.id, clusterId));

  await db
    .update(financeTransactions)
    .set({ category })
    .where(eq(financeTransactions.merchantClusterId, clusterId));

  return c.json({
    success: true,
    streamId: clusterId,
    category,
    merchantName: cluster.displayName ?? cluster.merchantNormalized,
    message: `Category updated to "${category}" for ${cluster.displayName ?? cluster.merchantNormalized}`,
  });
});

export default app;
