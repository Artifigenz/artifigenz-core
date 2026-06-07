import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  agentInstances,
  financeTransactions,
  financeAccounts,
  financeBriefs,
  financeInsights,
  merchantClusters,
  merchantBrands,
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
import { ingestPlaidConnection } from "../agents/finance/ingest/plaid-ingest";
import { advanceUploadsForConnection } from "../agents/finance/ingest/upload-ingest";
import { resolveMissingBrands } from "../agents/finance/enrich/resolver-pipeline";
import { detectInternalTransfers } from "../agents/finance/categorize/internal-transfer";
import { detectIncome } from "../agents/finance/categorize/income";

// How long between successive opportunistic Plaid syncs for a single
// connection. The frontend polls /agent-status every 3s during onboarding;
// without this throttle we'd hammer Plaid.
const SYNC_THROTTLE_MS = 30_000;

// How long to wait between brand-resolution passes per agent instance.
// The resolver does one LLM call per missing merchant — expensive — so
// we don't want to fire it on every poll. 10-min throttle is plenty since
// brand identity rarely changes. In-memory (lost on restart, fine: the
// resolver only touches missing merchants, so re-firing is cheap).
const BRAND_RESOLVE_THROTTLE_MS = 10 * 60_000;
const lastBrandResolveAt = new Map<string, number>();

async function maybeResolveBrands(agentInstanceId: string): Promise<void> {
  const last = lastBrandResolveAt.get(agentInstanceId) ?? 0;
  if (Date.now() - last < BRAND_RESOLVE_THROTTLE_MS) return;
  lastBrandResolveAt.set(agentInstanceId, Date.now());
  try {
    const stats = await resolveMissingBrands(agentInstanceId);
    if (stats.brandsResolved > 0 || stats.errors.length > 0) {
      console.log(
        `[brand-resolve] ${agentInstanceId}: +${stats.brandsResolved} resolved, ` +
          `${stats.errors.length} errors, ${stats.candidatesFound} candidates`,
      );
    }
    // Internal transfer detection only makes sense once brand resolution
    // has populated brand_slug — Layer 3 of the detector keys on it.
    // Fire-and-forget; idempotent so re-runs are cheap.
    void maybeDetectInternalTransfers(agentInstanceId);
  } catch (err) {
    console.error(`[brand-resolve] failed for ${agentInstanceId}:`, err);
  }
}

const INTERNAL_TRANSFER_THROTTLE_MS = 10 * 60_000;
const lastInternalTransferAt = new Map<string, number>();

async function maybeDetectInternalTransfers(
  agentInstanceId: string,
): Promise<void> {
  const last = lastInternalTransferAt.get(agentInstanceId) ?? 0;
  if (Date.now() - last < INTERNAL_TRANSFER_THROTTLE_MS) return;
  lastInternalTransferAt.set(agentInstanceId, Date.now());
  try {
    const stats = await detectInternalTransfers(agentInstanceId);
    const total = stats.pairMatched + stats.selfReferenceMatched + stats.llmClassified;
    if (total > 0 || stats.llmErrors.length > 0) {
      console.log(
        `[internal-transfer] ${agentInstanceId}: ` +
          `pair=${stats.pairMatched} self=${stats.selfReferenceMatched} ` +
          `llm=${stats.llmClassified} cache=${stats.cacheHits} ` +
          `errors=${stats.llmErrors.length}`,
      );
    }
    // Income runs after internal-transfer so paired transfers aren't
    // mistakenly classified as income inflows.
    void maybeDetectIncome(agentInstanceId);
  } catch (err) {
    console.error(`[internal-transfer] failed for ${agentInstanceId}:`, err);
  }
}

const INCOME_THROTTLE_MS = 10 * 60_000;
const lastIncomeAt = new Map<string, number>();

async function maybeDetectIncome(agentInstanceId: string): Promise<void> {
  const last = lastIncomeAt.get(agentInstanceId) ?? 0;
  if (Date.now() - last < INCOME_THROTTLE_MS) return;
  lastIncomeAt.set(agentInstanceId, Date.now());
  try {
    const stats = await detectIncome(agentInstanceId);
    if (
      stats.classifiedAsIncome > 0 ||
      stats.cacheHits > 0 ||
      stats.llmErrors.length > 0
    ) {
      const sub = Object.entries(stats.bySubtype)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(
        `[income] ${agentInstanceId}: ` +
          `income=${stats.classifiedAsIncome} not=${stats.classifiedAsNotIncome} ` +
          `cache=${stats.cacheHits} errors=${stats.llmErrors.length} ${sub}`,
      );
    }
  } catch (err) {
    console.error(`[income] failed for ${agentInstanceId}:`, err);
  }
}

// Watchdog: if a connection has been in_progress for this long, force it to
// "complete" regardless of consecutive-empty-sync count. This protects users
// from getting stuck on the loading page if the sync state machine fails to
// converge (e.g., persistent /sync errors that don't trip the failed path,
// or new transactions arriving every poll forever).
const INGEST_HARD_TIMEOUT_MS = 8 * 60_000;

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
 * GET /api/finance/clusters
 *   Returns merchant clusters built from the user's transactions. Pure
 *   grouping over `merchant_normalized` — no LLM categorization yet. Used
 *   by the breakdown clusters view so the user can see how transactions
 *   collapse into distinct merchants before we layer categories on top.
 */
app.get("/clusters", async (c) => {
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
      category: financeTransactions.category,
      systemCategory: financeTransactions.systemCategory,
      isRecurring: financeTransactions.isRecurring,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, instance.id));

  // Step 1: load brand mappings for every distinct merchant_normalized in
  // the user's txns. The merchant_brands table is global; we hit it once
  // up-front so the cluster groupby below can use brand_slug as the key.
  const distinctMerchants = Array.from(
    new Set(rows.map((r) => r.merchantNormalized).filter((s): s is string => !!s)),
  );
  const brandsByMerchant = new Map<
    string,
    {
      brandSlug: string | null;
      displayName: string | null;
      logoUrl: string | null;
      website: string | null;
    }
  >();
  if (distinctMerchants.length > 0) {
    const brandRows = await db
      .select({
        merchantNormalized: merchantBrands.merchantNormalized,
        brandSlug: merchantBrands.brandSlug,
        displayName: merchantBrands.displayName,
        logoUrl: merchantBrands.logoUrl,
        website: merchantBrands.website,
      })
      .from(merchantBrands)
      .where(inArray(merchantBrands.merchantNormalized, distinctMerchants));
    for (const b of brandRows) {
      brandsByMerchant.set(b.merchantNormalized, {
        brandSlug: b.brandSlug,
        displayName: b.displayName,
        logoUrl: b.logoUrl,
        website: b.website,
      });
    }
  }

  // Step 2: group by brand_slug when available, falling back to the
  // merchant_normalized string when the merchant hasn't been resolved yet.
  // This is what collapses BC Ferries' 7 variants into a single cluster.
  interface ClusterAgg {
    key: string;                       // brand_slug || merchant_normalized
    brandSlug: string | null;
    merchantNormalizedSeen: Set<string>; // every alias that contributed
    displayName: string;
    logoUrl: string | null;
    website: string | null;
    txnCount: number;
    totalAmount: number;
    inflowAmount: number;
    outflowAmount: number;
    firstSeen: string;
    lastSeen: string;
    category: string | null;
    systemCategory: string | null;
    isRecurring: boolean | null;
  }

  const map = new Map<string, ClusterAgg>();
  for (const r of rows) {
    const mn = r.merchantNormalized ?? "unknown";
    const brand = brandsByMerchant.get(mn);
    const key = brand?.brandSlug ?? mn;
    const amt = parseFloat(r.amount);
    const fallbackDisplay =
      (r.merchantName && r.merchantName.trim()) ||
      r.description.slice(0, 60).trim();

    let agg = map.get(key);
    if (!agg) {
      agg = {
        key,
        brandSlug: brand?.brandSlug ?? null,
        merchantNormalizedSeen: new Set([mn]),
        displayName: brand?.displayName ?? fallbackDisplay,
        logoUrl: brand?.logoUrl ?? null,
        website: brand?.website ?? null,
        txnCount: 0,
        totalAmount: 0,
        inflowAmount: 0,
        outflowAmount: 0,
        firstSeen: r.date,
        lastSeen: r.date,
        category: r.category,
        systemCategory: r.systemCategory,
        isRecurring: r.isRecurring,
      };
      map.set(key, agg);
    }
    agg.merchantNormalizedSeen.add(mn);
    agg.txnCount += 1;
    agg.totalAmount += amt;
    if (amt < 0) agg.inflowAmount += -amt;
    else agg.outflowAmount += amt;
    if (r.date < agg.firstSeen) agg.firstSeen = r.date;
    if (r.date > agg.lastSeen) agg.lastSeen = r.date;
  }

  const clusters = Array.from(map.values())
    .map((c) => ({
      // Primary identity exposed to the UI. brand_slug if resolved, else
      // the merchant_normalized fallback. The UI keys rows on this.
      key: c.key,
      brandSlug: c.brandSlug,
      // Surface the underlying aliases for debugging / "show variants" UX.
      aliases: Array.from(c.merchantNormalizedSeen).sort(),
      // For backward compat with existing UI code that still reads
      // merchantNormalized — we expose the first alias (deterministic via
      // sort) until callers migrate to `key`.
      merchantNormalized: Array.from(c.merchantNormalizedSeen).sort()[0],
      displayName: c.displayName,
      logoUrl: c.logoUrl,
      website: c.website,
      txnCount: c.txnCount,
      totalAmount: Math.round(c.totalAmount * 100) / 100,
      inflowAmount: Math.round(c.inflowAmount * 100) / 100,
      outflowAmount: Math.round(c.outflowAmount * 100) / 100,
      firstSeen: c.firstSeen,
      lastSeen: c.lastSeen,
      category: c.category,
      systemCategory: c.systemCategory,
      isRecurring: c.isRecurring,
    }))
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount));

  return c.json({
    count: clusters.length,
    clusters,
  });
});

/**
 * GET /api/finance/agent-status
 *   The frontend onboarding loader polls this every ~3s to render the
 *   per-connection ingestion progress. Each call:
 *     - reads the current state from the DB
 *     - opportunistically kicks a Plaid sync if a connection is in_progress
 *       and hasn't been synced in SYNC_THROTTLE_MS (fire-and-forget)
 *     - returns whatever the truth is right now
 *
 *   The fire-and-forget sync is awaited only briefly via a 100ms grace
 *   period so the caller gets fresh-ish state without waiting for Plaid.
 */
/**
 * GET /api/finance/categories
 *   Returns count + total per category bucket for the current user's
 *   finance agent. Used by the Categories tab on /finance/breakdown.
 *   Only buckets with > 0 transactions are returned.
 */
app.get("/categories", async (c) => {
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
  if (!instance) return c.json({ categories: [] });

  // One pass over the user's txns, group by category.
  const rows = await db
    .select({
      category: financeTransactions.category,
      amount: financeTransactions.amount,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, instance.id));

  interface Bucket {
    category: string;
    label: string;
    count: number;
    totalAbs: number;
    inflow: number;
    outflow: number;
  }
  const labelMap: Record<string, string> = {
    income: "Income",
    subscription: "Subscriptions",
    loan_emi: "Loans & EMI",
    fee_interest: "Bank fees & interest",
    variable_recurring: "Recurring variable",
    internal_transfer: "Internal transfers",
    miscellaneous: "Miscellaneous",
    uncategorized: "Uncategorized",
  };

  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const cat = r.category ?? "uncategorized";
    const amt = parseFloat(r.amount);
    let b = map.get(cat);
    if (!b) {
      b = {
        category: cat,
        label: labelMap[cat] ?? cat,
        count: 0,
        totalAbs: 0,
        inflow: 0,
        outflow: 0,
      };
      map.set(cat, b);
    }
    b.count++;
    b.totalAbs += Math.abs(amt);
    if (amt > 0) b.outflow += amt;
    else b.inflow += -amt;
  }

  const categories = Array.from(map.values())
    .map((b) => ({
      category: b.category,
      label: b.label,
      count: b.count,
      totalAbs: Math.round(b.totalAbs * 100) / 100,
      inflow: Math.round(b.inflow * 100) / 100,
      outflow: Math.round(b.outflow * 100) / 100,
    }))
    .sort((a, b) => b.totalAbs - a.totalAbs);

  return c.json({ categories });
});

/**
 * GET /api/finance/categories/internal-transfers
 *   Returns the detail view: paired transfers collapsed into one row
 *   with both halves' account context, plus any unpaired internals
 *   below. The UI mounts this at /finance/breakdown/categories/internal-transfers.
 */
app.get("/categories/internal-transfers", async (c) => {
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
  if (!instance) return c.json({ pairs: [], unpaired: [], total: 0 });

  const rows = await db
    .select({
      id: financeTransactions.id,
      transferPairId: financeTransactions.transferPairId,
      accountId: financeTransactions.accountId,
      direction: financeTransactions.direction,
      amount: financeTransactions.amount,
      transactionDate: financeTransactions.transactionDate,
      description: financeTransactions.description,
      systemCategory: financeTransactions.systemCategory,
      confidence: financeTransactions.confidence,
      reasoning: financeTransactions.reasoning,
      institutionName: financeAccounts.institutionName,
      accountLast4: financeAccounts.accountLast4,
      accountType: financeAccounts.type,
    })
    .from(financeTransactions)
    .leftJoin(financeAccounts, eq(financeTransactions.accountId, financeAccounts.id))
    .where(
      and(
        eq(financeTransactions.agentInstanceId, instance.id),
        eq(financeTransactions.category, "internal_transfer"),
      ),
    );

  // Collapse rows sharing a transfer_pair_id into one paired view.
  type Row = (typeof rows)[number];
  const byPair = new Map<string, Row[]>();
  const unpaired: Row[] = [];
  for (const r of rows) {
    if (r.transferPairId) {
      const arr = byPair.get(r.transferPairId) ?? [];
      arr.push(r);
      byPair.set(r.transferPairId, arr);
    } else {
      unpaired.push(r);
    }
  }

  const accountLabel = (r: Row) => {
    if (!r.institutionName) return "Unknown account";
    return `${r.institutionName.charAt(0).toUpperCase() + r.institutionName.slice(1)} ${r.accountType ?? ""} ••${r.accountLast4 ?? "?"}`.replace(/\s+/g, " ").trim();
  };

  const pairs = Array.from(byPair.values())
    .map((halves) => {
      const out = halves.find((h) => h.direction === "out") ?? halves[0];
      const ins = halves.find((h) => h.direction === "in") ?? halves[1] ?? halves[0];
      const amount = Math.abs(parseFloat(out.amount));
      return {
        pairId: out.transferPairId!,
        fromLabel: accountLabel(out),
        toLabel: accountLabel(ins),
        amount: Math.round(amount * 100) / 100,
        date: out.transactionDate,
        systemCategory: out.systemCategory,
        outDescription: out.description,
        inDescription: ins.description,
        outId: out.id,
        inId: ins.id,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const unpairedView = unpaired
    .map((r) => ({
      id: r.id,
      label: accountLabel(r),
      direction: r.direction,
      amount: Math.round(Math.abs(parseFloat(r.amount)) * 100) / 100,
      date: r.transactionDate,
      description: r.description,
      systemCategory: r.systemCategory,
      reasoning: r.reasoning,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const total =
    pairs.reduce((s, p) => s + p.amount, 0) +
    unpairedView.reduce((s, u) => s + u.amount, 0);

  return c.json({
    pairs,
    unpaired: unpairedView,
    total: Math.round(total * 100) / 100,
  });
});

/**
 * GET /api/finance/categories/income
 *   Returns income transactions grouped by subtype (salary,
 *   investment_income, gov_benefit). For each subtype we surface the
 *   brand streams underneath (one row per brand_slug with cadence
 *   summary), since income is naturally a "who's paying me" view.
 */
app.get("/categories/income", async (c) => {
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
  if (!instance) {
    return c.json({ subtypes: [], total: 0 });
  }

  // Pull income rows + brand metadata in one query.
  const rows = await db.execute<{
    brand_slug: string | null;
    display_name: string | null;
    logo_url: string | null;
    system_category: string | null;
    txn_count: number;
    total: string;
    first_date: string;
    last_date: string;
    distinct_dates: number;
    span_days: number;
  }>(sql`
    SELECT
      mb.brand_slug,
      mb.display_name,
      mb.logo_url,
      ft.system_category,
      COUNT(*)::int AS txn_count,
      ABS(SUM(ft.amount::numeric))::text AS total,
      MIN(ft.transaction_date)::text AS first_date,
      MAX(ft.transaction_date)::text AS last_date,
      COUNT(DISTINCT ft.transaction_date)::int AS distinct_dates,
      GREATEST(MAX(ft.transaction_date) - MIN(ft.transaction_date), 1)::int AS span_days
    FROM finance_transactions ft
    LEFT JOIN merchant_brands mb
      ON ft.merchant_normalized = mb.merchant_normalized
    WHERE ft.agent_instance_id = ${instance.id}
      AND ft.category = 'income'
    GROUP BY mb.brand_slug, mb.display_name, mb.logo_url, ft.system_category
    ORDER BY ft.system_category, ABS(SUM(ft.amount::numeric)) DESC
  `);

  interface Stream {
    brandSlug: string;
    displayName: string;
    logoUrl: string | null;
    txnCount: number;
    total: number;
    firstDate: string;
    lastDate: string;
    cadence: string;
  }
  const subtypeMap = new Map<
    string,
    { subtype: string; label: string; total: number; streams: Stream[] }
  >();

  const SUBTYPE_LABELS: Record<string, string> = {
    salary: "Salary",
    investment_income: "Investment income",
    gov_benefit: "Government benefits",
    other: "Other income",
  };

  const cadenceFor = (
    distinctDates: number,
    spanDays: number,
    txnCount: number,
  ): string => {
    if (txnCount <= 1) return "one-off";
    const gap = distinctDates > 1 ? spanDays / (distinctDates - 1) : 0;
    if (gap >= 6 && gap <= 8) return "weekly";
    if (gap >= 12 && gap <= 16) return "biweekly";
    if (gap >= 27 && gap <= 33) return "monthly";
    if (gap >= 85 && gap <= 95) return "quarterly";
    if (gap >= 350 && gap <= 380) return "annual";
    return "irregular";
  };

  for (const r of rows) {
    const subtype = r.system_category ?? "other";
    let bucket = subtypeMap.get(subtype);
    if (!bucket) {
      bucket = {
        subtype,
        label: SUBTYPE_LABELS[subtype] ?? subtype,
        total: 0,
        streams: [],
      };
      subtypeMap.set(subtype, bucket);
    }
    const total = parseFloat(r.total);
    bucket.total += total;
    bucket.streams.push({
      brandSlug: r.brand_slug ?? "unknown",
      displayName: r.display_name ?? r.brand_slug ?? "Unknown",
      logoUrl: r.logo_url,
      txnCount: r.txn_count,
      total: Math.round(total * 100) / 100,
      firstDate: r.first_date,
      lastDate: r.last_date,
      cadence: cadenceFor(r.distinct_dates, r.span_days, r.txn_count),
    });
  }

  const ordering = ["salary", "investment_income", "gov_benefit", "other"];
  const subtypes = Array.from(subtypeMap.values())
    .map((s) => ({ ...s, total: Math.round(s.total * 100) / 100 }))
    .sort((a, b) => ordering.indexOf(a.subtype) - ordering.indexOf(b.subtype));

  const total = subtypes.reduce((s, sub) => s + sub.total, 0);
  return c.json({
    subtypes,
    total: Math.round(total * 100) / 100,
  });
});

app.get("/agent-status", async (c) => {
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
    return c.json({
      agentExists: false,
      ingestionComplete: true,
      totalTransactions: 0,
      connections: [],
    });
  }

  const conns = await db
    .select({
      id: dataSourceConnections.id,
      dataSourceTypeId: dataSourceConnections.dataSourceTypeId,
      displayName: dataSourceConnections.displayName,
      ingestionState: dataSourceConnections.ingestionState,
      ingestionStartedAt: dataSourceConnections.ingestionStartedAt,
      ingestionCompletedAt: dataSourceConnections.ingestionCompletedAt,
      lastSyncedAt: dataSourceConnections.lastSyncedAt,
      lastSyncStatus: dataSourceConnections.lastSyncStatus,
      lastSyncError: dataSourceConnections.lastSyncError,
      lastSyncAddedCount: dataSourceConnections.lastSyncAddedCount,
      consecutiveEmptySyncs: dataSourceConnections.consecutiveEmptySyncs,
    })
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.agentInstanceId, instance.id));

  // Compute per-connection transaction counts in one query.
  const counts = await db
    .select({
      accountId: financeAccounts.id,
      dataSourceConnectionId: financeAccounts.dataSourceConnectionId,
    })
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, instance.id));
  const accountToConn = new Map<string, string | null>();
  for (const a of counts) accountToConn.set(a.accountId, a.dataSourceConnectionId);

  const txRows = await db
    .select({
      id: financeTransactions.id,
      accountId: financeTransactions.accountId,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, instance.id));

  const perConnCount = new Map<string, number>();
  for (const tx of txRows) {
    if (!tx.accountId) continue;
    const connId = accountToConn.get(tx.accountId);
    if (!connId) continue;
    perConnCount.set(connId, (perConnCount.get(connId) ?? 0) + 1);
  }

  // Account count: derived from finance_accounts rows (which exist as soon
  // as Plaid Link metadata is finalized), NOT from transactions. Using txn
  // rows used to show "0 accounts" during the initial pull because txns
  // arrive after accounts are created.
  const perConnAccountsTotal = new Map<string, number>();
  for (const a of counts) {
    const connId = a.dataSourceConnectionId;
    if (!connId) continue;
    perConnAccountsTotal.set(connId, (perConnAccountsTotal.get(connId) ?? 0) + 1);
  }

  // Pull per-connection file_upload state so we can show parsing progress.
  const fileRows = await db
    .select({
      id: fileUploads.id,
      dataSourceConnectionId: fileUploads.dataSourceConnectionId,
      originalFilename: fileUploads.originalFilename,
      parseState: fileUploads.parseState,
      parseError: fileUploads.parseError,
      institutionName: fileUploads.institutionName,
      accountLast4: fileUploads.accountLast4,
      statementPeriodStart: fileUploads.statementPeriodStart,
      statementPeriodEnd: fileUploads.statementPeriodEnd,
    })
    .from(fileUploads)
    .where(
      inArray(
        fileUploads.dataSourceConnectionId,
        conns.map((c) => c.id),
      ),
    );
  const filesByConn = new Map<string, typeof fileRows>();
  for (const f of fileRows) {
    const arr = filesByConn.get(f.dataSourceConnectionId) ?? [];
    arr.push(f);
    filesByConn.set(f.dataSourceConnectionId, arr);
  }

  // Watchdog: a connection that's been in_progress longer than
  // INGEST_HARD_TIMEOUT_MS gets forced out of in_progress. Connections that
  // actually pulled transactions land on 'complete' (we're done). Connections
  // that pulled zero land on 'failed' — silently completing a zero-txn
  // connection would strand the user with no data and a "ready" banner.
  const watchdogNow = Date.now();
  for (const conn of conns) {
    if (conn.ingestionState !== "in_progress") continue;
    if (!conn.ingestionStartedAt) continue;
    const ageMs =
      watchdogNow - new Date(conn.ingestionStartedAt).getTime();
    if (ageMs <= INGEST_HARD_TIMEOUT_MS) continue;
    const txnsForConn = perConnCount.get(conn.id) ?? 0;
    const forcedState: "complete" | "failed" =
      txnsForConn > 0 ? "complete" : "failed";
    const forcedError =
      forcedState === "failed"
        ? "Plaid did not return any transactions within the ingest window. The bank may still be backfilling history; try reconnecting in a few minutes."
        : null;
    await db
      .update(dataSourceConnections)
      .set({
        ingestionState: forcedState,
        ingestionCompletedAt: new Date(),
        ...(forcedError ? { lastSyncError: forcedError } : {}),
        updatedAt: new Date(),
      })
      .where(eq(dataSourceConnections.id, conn.id));
    conn.ingestionState = forcedState;
    conn.ingestionCompletedAt = new Date();
    if (forcedError) conn.lastSyncError = forcedError;
    console.log(
      `[agent-status] watchdog: forced ${conn.id} to ${forcedState} after ${Math.round(ageMs / 1000)}s (${txnsForConn} txns)`,
    );
  }

  // Kick throttled Plaid syncs + file parses for in_progress connections.
  const now = Date.now();
  const triggered: string[] = [];
  for (const conn of conns) {
    const lastSyncMs = conn.lastSyncedAt
      ? new Date(conn.lastSyncedAt).getTime()
      : 0;

    if (conn.dataSourceTypeId === "plaid") {
      if (conn.ingestionState !== "in_progress" && conn.ingestionState !== "pending") continue;
      if (now - lastSyncMs < SYNC_THROTTLE_MS) continue;
      triggered.push(conn.id);
      void ingestPlaidConnection(conn.id).catch((err) => {
        console.error(`[agent-status] plaid sync failed for ${conn.id}:`, err);
      });
    } else if (conn.dataSourceTypeId === "file-upload") {
      // For file uploads, kick the parse advance if there are pending or
      // validated files. The validation step is idempotent and fast; the
      // full parse claims the row atomically so multiple polls don't race.
      const files = filesByConn.get(conn.id) ?? [];
      const hasWork = files.some(
        (f) => f.parseState === "validated" || f.parseState === "pending",
      );
      if (!hasWork) continue;
      // Throttle: only kick once per 5s per connection (parse is slow; we
      // don't want to spam Claude requests if a poll happens mid-parse).
      if (now - lastSyncMs < 5000) continue;
      triggered.push(conn.id);
      void advanceUploadsForConnection(conn.id).catch((err) => {
        console.error(`[agent-status] upload parse failed for ${conn.id}:`, err);
      });
    }
  }

  const ingestionComplete = conns.every(
    (c) =>
      c.ingestionState === "complete" ||
      c.ingestionState === "failed" ||
      c.ingestionState === "needs_auth",
  );

  // Once everything finishes ingesting, kick the hybrid brand resolver.
  // It only touches merchants we haven't enriched yet (anti-join against
  // the global merchant_brands cache), so the cost is amortised across
  // all users — popular merchants get resolved once, ever.
  if (ingestionComplete && conns.length > 0) {
    void maybeResolveBrands(instance.id);
  }

  return c.json({
    agentExists: true,
    agentInstanceId: instance.id,
    agentStatus: instance.status,
    ingestionComplete,
    totalTransactions: txRows.length,
    connections: conns.map((c) => {
      const files = filesByConn.get(c.id) ?? [];
      return {
        id: c.id,
        dataSourceTypeId: c.dataSourceTypeId,
        displayName: c.displayName,
        ingestionState: c.ingestionState,
        ingestionStartedAt: c.ingestionStartedAt,
        ingestionCompletedAt: c.ingestionCompletedAt,
        lastSyncedAt: c.lastSyncedAt,
        lastSyncStatus: c.lastSyncStatus,
        lastSyncError: c.lastSyncError,
        lastSyncAddedCount: c.lastSyncAddedCount,
        consecutiveEmptySyncs: c.consecutiveEmptySyncs,
        transactionCount: perConnCount.get(c.id) ?? 0,
        accountCount: perConnAccountsTotal.get(c.id) ?? 0,
        syncTriggered: triggered.includes(c.id),
        files: files.map((f) => ({
          id: f.id,
          filename: f.originalFilename,
          parseState: f.parseState,
          parseError: f.parseError,
          institutionName: f.institutionName,
          accountLast4: f.accountLast4,
          statementPeriodStart: f.statementPeriodStart,
          statementPeriodEnd: f.statementPeriodEnd,
        })),
      };
    }),
  });
});

/**
 * PATCH /api/finance/file-uploads/:fileId
 *   User-correctable metadata on an uploaded statement. Right now we only
 *   accept institutionName edits — fixes the "wrong bank" case where the
 *   validator was unsure or wrong. Re-points the linked account to the
 *   corrected (institution + last4) identity.
 */
app.patch("/file-uploads/:fileId", async (c) => {
  const user = c.get("user");
  const fileId = c.req.param("fileId");
  const body = await c.req.json<{ institutionName?: string }>();

  if (typeof body.institutionName !== "string" || !body.institutionName.trim()) {
    return c.json({ error: "institutionName is required" }, 400);
  }
  const newName = body.institutionName.trim();

  // Authorize — file must belong to one of this user's finance connections.
  const [row] = await db
    .select({
      fileId: fileUploads.id,
      accountId: fileUploads.accountId,
      accountLast4: fileUploads.accountLast4,
      connectionId: fileUploads.dataSourceConnectionId,
      agentInstanceId: dataSourceConnections.agentInstanceId,
      agentTypeId: agentInstances.agentTypeId,
      userId: agentInstances.userId,
    })
    .from(fileUploads)
    .leftJoin(
      dataSourceConnections,
      eq(dataSourceConnections.id, fileUploads.dataSourceConnectionId),
    )
    .leftJoin(
      agentInstances,
      eq(agentInstances.id, dataSourceConnections.agentInstanceId),
    )
    .where(eq(fileUploads.id, fileId))
    .limit(1);

  if (!row || row.userId !== user.id || row.agentTypeId !== "finance") {
    return c.json({ error: "File not found" }, 404);
  }

  await db
    .update(fileUploads)
    .set({ institutionName: newName })
    .where(eq(fileUploads.id, fileId));

  // Rename the linked account so the breakdown + accounts page reflect
  // the correction. If a different account already exists with the new
  // (institution, last4) identity, MERGE: re-point all txns and other
  // file_uploads from the old account onto the existing one, then drop
  // the old row. Without this, the unique constraint would fire and the
  // rename silently failed.
  if (row.accountId && row.agentInstanceId) {
    const normalized = newName.toLowerCase().replace(/\s+/g, " ").trim();
    const last4 = row.accountLast4;
    if (last4) {
      const [conflict] = await db
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(
          and(
            eq(financeAccounts.agentInstanceId, row.agentInstanceId),
            eq(financeAccounts.institutionName, normalized),
            eq(financeAccounts.accountLast4, last4),
          ),
        )
        .limit(1);

      if (conflict && conflict.id !== row.accountId) {
        // Merge: move children, drop the orphan.
        await db
          .update(financeTransactions)
          .set({ accountId: conflict.id })
          .where(eq(financeTransactions.accountId, row.accountId));
        await db
          .update(fileUploads)
          .set({ accountId: conflict.id })
          .where(eq(fileUploads.accountId, row.accountId));
        await db
          .delete(financeAccounts)
          .where(eq(financeAccounts.id, row.accountId));
      } else {
        await db
          .update(financeAccounts)
          .set({ institutionName: normalized })
          .where(eq(financeAccounts.id, row.accountId));
      }
    } else {
      await db
        .update(financeAccounts)
        .set({ institutionName: normalized })
        .where(eq(financeAccounts.id, row.accountId));
    }
  }

  return c.json({ success: true, institutionName: newName });
});

/**
 * GET /api/finance/accounts
 *   Lists every finance_account the user has, joined with its source
 *   signals — Plaid connection (if any) and uploaded statements (if any).
 *   One row per account, regardless of how many sources it has.
 */
app.get("/accounts", async (c) => {
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

  if (!instance) return c.json({ accounts: [] });

  const accts = await db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, instance.id));

  // Pull every connection on the instance so we can attach source info.
  const conns = await db
    .select()
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.agentInstanceId, instance.id));
  const connById = new Map(conns.map((c) => [c.id, c]));

  // Pull every file_upload so each account can list its statements.
  const files = await db
    .select()
    .from(fileUploads)
    .where(
      inArray(
        fileUploads.dataSourceConnectionId,
        conns.map((c) => c.id),
      ),
    );

  // Transaction counts per account (one query, group in JS).
  const txCounts = await db
    .select({
      accountId: financeTransactions.accountId,
      id: financeTransactions.id,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, instance.id));
  const perAccount = new Map<string, number>();
  for (const t of txCounts) {
    if (!t.accountId) continue;
    perAccount.set(t.accountId, (perAccount.get(t.accountId) ?? 0) + 1);
  }

  const accounts = accts.map((a) => {
    const ownerConn = a.dataSourceConnectionId
      ? connById.get(a.dataSourceConnectionId)
      : null;
    const plaidConn =
      ownerConn?.dataSourceTypeId === "plaid"
        ? ownerConn
        : conns.find((c) => c.dataSourceTypeId === "plaid" && c.id === a.dataSourceConnectionId);
    const uploadConn = conns.find((c) => c.dataSourceTypeId === "file-upload");

    const statements = files
      .filter((f) => f.accountId === a.id)
      .sort((x, y) => (x.statementPeriodEnd ?? '').localeCompare(y.statementPeriodEnd ?? ''))
      .map((f) => ({
        id: f.id,
        filename: f.originalFilename,
        parseState: f.parseState,
        uploadedAt: f.uploadedAt,
        statementPeriodStart: f.statementPeriodStart,
        statementPeriodEnd: f.statementPeriodEnd,
        transactionCount: f.transactionCount,
      }));

    return {
      id: a.id,
      institutionName: a.institutionName,
      accountLast4: a.accountLast4,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      currentBalance: a.currentBalance ? parseFloat(a.currentBalance) : null,
      availableBalance: a.availableBalance ? parseFloat(a.availableBalance) : null,
      isoCurrencyCode: a.isoCurrencyCode,
      transactionCount: perAccount.get(a.id) ?? 0,
      plaid: plaidConn
        ? {
            connectionId: plaidConn.id,
            displayName: plaidConn.displayName,
            status: plaidConn.status,
            lastSyncedAt: plaidConn.lastSyncedAt,
            requiresReauth: plaidConn.requiresReauth ?? false,
            ingestionState: plaidConn.ingestionState,
          }
        : null,
      upload: statements.length > 0 && uploadConn
        ? {
            connectionId: uploadConn.id,
            statements,
          }
        : null,
    };
  });

  return c.json({ accounts });
});

/**
 * POST /api/finance/resync
 *   Re-runs Plaid ingestion for every active Plaid connection on the caller's
 *   finance agent, then re-categorizes. Useful when Plaid's initial historical
 *   backfill arrived after the onboarding sync (the webhook normally handles
 *   that, but you can also trigger it manually from Devtools).
 *
 *   Returns per-connection sync counts.
 */
app.post("/resync", async (c) => {
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

  const conns = await db
    .select({
      id: dataSourceConnections.id,
      displayName: dataSourceConnections.displayName,
    })
    .from(dataSourceConnections)
    .where(
      and(
        eq(dataSourceConnections.agentInstanceId, instance.id),
        eq(dataSourceConnections.dataSourceTypeId, "plaid"),
        eq(dataSourceConnections.status, "active"),
      ),
    );

  const perConnection: Array<{
    displayName: string | null;
    inserted: number;
    skipped: number;
    accounts: number;
    error?: string;
  }> = [];

  for (const conn of conns) {
    try {
      const result = await ingestPlaidConnection(conn.id);
      perConnection.push({
        displayName: conn.displayName,
        inserted: result.transactionsInserted,
        skipped: result.transactionsSkipped,
        accounts: result.accountsUpserted,
      });
    } catch (err) {
      perConnection.push({
        displayName: conn.displayName,
        inserted: 0,
        skipped: 0,
        accounts: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const categorize = await categorizeAgentInstance(instance.id);
  await backfillOrphans(instance.id);

  return c.json({
    success: true,
    perConnection,
    categorize: {
      clustersAnalyzed: categorize.clustersAnalyzed,
      clustersSkippedCached: categorize.clustersSkippedCached,
      txnsBackfilled: categorize.txnsBackfilled,
    },
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

  // Also remove the user's upload directory on disk. Statement PDFs/CSVs
  // are stored under tmpdir()/artifigenz-uploads/<userId>/ during validate
  // + parse — we don't need them after the rows are gone.
  let diskCleared = false;
  try {
    await rm(join(tmpdir(), "artifigenz-uploads", user.id), {
      recursive: true,
      force: true,
    });
    diskCleared = true;
  } catch (err) {
    console.warn(`[finance/wipe] disk cleanup failed for ${user.id}:`, err);
  }

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
      uploadFilesOnDisk: diskCleared ? 1 : 0,
    },
  });
});

export default app;
