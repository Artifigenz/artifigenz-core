import { sql } from "drizzle-orm";
import { db } from "@artifigenz/db";

/**
 * Brief computation — pure SQL aggregation. No LLM, no caching.
 *
 * Two flavors:
 *   computeMonthBrief(instance, "YYYY-MM-01") — one specific month
 *   computeAllTimeBrief(instance) — averaged across all complete months
 *
 * The "numbers" half of the brief is always recomputed on request so it
 * stays in sync with new transactions arriving. The expensive part is
 * the LLM headline; that's cached separately.
 */

export interface BrandStat {
  brandSlug: string;
  displayName: string;
  logoUrl: string | null;
  total: number;
  txnCount: number;
}

export interface CategoryBreakdown {
  category: string;
  total: number;
  txnCount: number;
  topBrands: BrandStat[];
}

export interface BriefNumbers {
  income: number;
  outflow: number;
  leftover: number;
  byCategory: CategoryBreakdown[];
  // Identifier of the period these numbers describe — either an ISO
  // YYYY-MM-01 for a specific month or "all" for the averaged view.
  scope: string;
  // Convenience labels for the UI ("May 2026", "All time").
  label: string;
}

export interface BriefSignals {
  // Each signal is a structured fact the LLM can anchor the headline on.
  ranked: Signal[];
}

export type Signal =
  | { type: "surplus"; percent: number; amount: number }
  | { type: "deficit"; percent: number; amount: number }
  | { type: "break_even" }
  | { type: "mom_spend_change"; deltaPercent: number; prevMonth: string }
  | { type: "new_subscription"; brands: string[] }
  | { type: "potentially_cancelled_subscription"; brands: string[] }
  | {
      type: "category_mover";
      category: string;
      deltaPercent: number;
      from: number;
      to: number;
    }
  | { type: "missing_expected_charge"; brand: string; lastSeen: string }
  | { type: "no_income"; }
  | { type: "first_full_month"; }; // when prior-month data isn't available

// ─── Numbers ─────────────────────────────────────────────────────

const NON_OUTFLOW = new Set(["income", "internal_transfer"]);

/**
 * Per-category totals + top-3 brands per category for the given month.
 */
export async function computeMonthNumbers(
  agentInstanceId: string,
  month: string, // YYYY-MM-01
): Promise<BriefNumbers> {
  const rows = await db.execute<{
    category: string;
    total: string;
    txn_count: number;
    brand_slug: string | null;
    display_name: string | null;
    logo_url: string | null;
    brand_total: string;
    brand_txns: number;
  }>(sql`
    WITH month_txns AS (
      SELECT
        ft.category,
        ft.merchant_normalized,
        ft.amount,
        mb.brand_slug,
        mb.display_name,
        mb.logo_url
      FROM finance_transactions ft
      LEFT JOIN merchant_brands mb
        ON ft.merchant_normalized = mb.merchant_normalized
      WHERE ft.agent_instance_id = ${agentInstanceId}
        AND ft.category IS NOT NULL
        AND ft.transaction_date >= ${month}::date
        AND ft.transaction_date < (${month}::date + INTERVAL '1 month')
    ),
    cat_totals AS (
      SELECT
        category,
        ABS(SUM(amount::numeric))::text AS total,
        COUNT(*)::int AS txn_count
      FROM month_txns
      GROUP BY category
    ),
    cat_brand_totals AS (
      SELECT
        category,
        brand_slug,
        MAX(display_name) AS display_name,
        MAX(logo_url) AS logo_url,
        ABS(SUM(amount::numeric))::text AS brand_total,
        COUNT(*)::int AS brand_txns,
        ROW_NUMBER() OVER (
          PARTITION BY category
          ORDER BY ABS(SUM(amount::numeric)) DESC
        ) AS rn
      FROM month_txns
      WHERE brand_slug IS NOT NULL
      GROUP BY category, brand_slug
    )
    SELECT
      c.category,
      c.total,
      c.txn_count,
      b.brand_slug,
      b.display_name,
      b.logo_url,
      b.brand_total,
      b.brand_txns
    FROM cat_totals c
    LEFT JOIN cat_brand_totals b
      ON c.category = b.category AND b.rn <= 3
    ORDER BY c.category, b.brand_total DESC NULLS LAST
  `);

  return shapeBriefNumbers(rows, month, formatMonthLabel(month));
}

/**
 * Averaged across all complete months. We deliberately exclude the
 * current (incomplete) month so the average isn't dragged down by a
 * partial period.
 */
export async function computeAllTimeNumbers(
  agentInstanceId: string,
): Promise<BriefNumbers> {
  const rows = await db.execute<{
    category: string;
    total: string;
    txn_count: number;
    brand_slug: string | null;
    display_name: string | null;
    logo_url: string | null;
    brand_total: string;
    brand_txns: number;
  }>(sql`
    WITH bounds AS (
      SELECT
        DATE_TRUNC('month', MIN(transaction_date))::date AS first_month,
        DATE_TRUNC('month', CURRENT_DATE)::date AS current_month
      FROM finance_transactions
      WHERE agent_instance_id = ${agentInstanceId}
        AND category IS NOT NULL
    ),
    -- months_complete = number of fully-elapsed months in the data range,
    -- excluding the current (in-progress) month. Used to compute averages.
    month_count AS (
      SELECT
        GREATEST(
          (EXTRACT(YEAR FROM AGE(current_month, first_month))::int * 12 +
           EXTRACT(MONTH FROM AGE(current_month, first_month))::int),
          1
        ) AS n
      FROM bounds
    ),
    base AS (
      SELECT
        ft.category,
        ft.merchant_normalized,
        ft.amount,
        mb.brand_slug,
        mb.display_name,
        mb.logo_url
      FROM finance_transactions ft
      LEFT JOIN merchant_brands mb
        ON ft.merchant_normalized = mb.merchant_normalized
      CROSS JOIN bounds
      WHERE ft.agent_instance_id = ${agentInstanceId}
        AND ft.category IS NOT NULL
        AND ft.transaction_date < current_month
    ),
    cat_totals AS (
      SELECT
        category,
        (ABS(SUM(amount::numeric)) / (SELECT n FROM month_count))::text AS total,
        (COUNT(*) / GREATEST((SELECT n FROM month_count), 1))::int AS txn_count
      FROM base
      GROUP BY category
    ),
    cat_brand_totals AS (
      SELECT
        category,
        brand_slug,
        MAX(display_name) AS display_name,
        MAX(logo_url) AS logo_url,
        (ABS(SUM(amount::numeric)) / (SELECT n FROM month_count))::text AS brand_total,
        (COUNT(*) / GREATEST((SELECT n FROM month_count), 1))::int AS brand_txns,
        ROW_NUMBER() OVER (
          PARTITION BY category
          ORDER BY ABS(SUM(amount::numeric)) DESC
        ) AS rn
      FROM base
      WHERE brand_slug IS NOT NULL
      GROUP BY category, brand_slug
    )
    SELECT
      c.category,
      c.total,
      c.txn_count,
      b.brand_slug,
      b.display_name,
      b.logo_url,
      b.brand_total,
      b.brand_txns
    FROM cat_totals c
    LEFT JOIN cat_brand_totals b
      ON c.category = b.category AND b.rn <= 3
    ORDER BY c.category, b.brand_total DESC NULLS LAST
  `);

  return shapeBriefNumbers(rows, "all", "Average per month");
}

function shapeBriefNumbers(
  rows: Array<{
    category: string;
    total: string;
    txn_count: number;
    brand_slug: string | null;
    display_name: string | null;
    logo_url: string | null;
    brand_total: string;
    brand_txns: number;
  }>,
  scope: string,
  label: string,
): BriefNumbers {
  const catMap = new Map<string, CategoryBreakdown>();
  for (const r of rows) {
    let bucket = catMap.get(r.category);
    if (!bucket) {
      bucket = {
        category: r.category,
        total: Math.round(parseFloat(r.total) * 100) / 100,
        txnCount: r.txn_count,
        topBrands: [],
      };
      catMap.set(r.category, bucket);
    }
    if (r.brand_slug) {
      bucket.topBrands.push({
        brandSlug: r.brand_slug,
        displayName: r.display_name ?? r.brand_slug,
        logoUrl: r.logo_url,
        total: Math.round(parseFloat(r.brand_total) * 100) / 100,
        txnCount: r.brand_txns,
      });
    }
  }

  let income = 0;
  let outflow = 0;
  for (const [cat, b] of catMap) {
    if (cat === "income") income += b.total;
    else if (!NON_OUTFLOW.has(cat)) outflow += b.total;
  }
  const leftover = income - outflow;

  return {
    income: Math.round(income * 100) / 100,
    outflow: Math.round(outflow * 100) / 100,
    leftover: Math.round(leftover * 100) / 100,
    byCategory: Array.from(catMap.values()),
    scope,
    label,
  };
}

// ─── Signals ─────────────────────────────────────────────────────

/**
 * Compute structured insights for a given month. The headline LLM call
 * picks 1-2 of these to lean on. Order in the returned array IS the
 * priority — the LLM is told to highlight the top entries.
 *
 * For the "all" view we surface a smaller set: surplus/deficit + the
 * average-vs-most-recent-month spend change. MoM-style insights aren't
 * meaningful when the period IS the whole history.
 */
export async function computeMonthSignals(
  agentInstanceId: string,
  month: string,
  numbers: BriefNumbers,
): Promise<BriefSignals> {
  const ranked: Signal[] = [];

  // 1. Surplus / deficit.
  if (numbers.income > 0) {
    const delta = numbers.income - numbers.outflow;
    const pct = Math.round((Math.abs(delta) / numbers.income) * 100);
    if (delta > 50) ranked.push({ type: "surplus", percent: pct, amount: delta });
    else if (delta < -50)
      ranked.push({ type: "deficit", percent: pct, amount: Math.abs(delta) });
    else ranked.push({ type: "break_even" });
  } else {
    ranked.push({ type: "no_income" });
  }

  // 2. MoM total-spend delta. Prior month is month - 1.
  const prevMonth = shiftMonth(month, -1);
  const prevTotal = await monthOutflow(agentInstanceId, prevMonth);
  if (prevTotal === null) {
    ranked.push({ type: "first_full_month" });
  } else if (prevTotal > 0) {
    const deltaPct = Math.round(
      ((numbers.outflow - prevTotal) / prevTotal) * 100,
    );
    if (Math.abs(deltaPct) >= 8) {
      ranked.push({
        type: "mom_spend_change",
        deltaPercent: deltaPct,
        prevMonth,
      });
    }
  }

  // 3. New subscriptions this month — brands that show as subscription
  //    in this month with first-ever charge inside this window.
  const newSubs = await db.execute<{ display_name: string }>(sql`
    SELECT DISTINCT mb.display_name
    FROM finance_transactions ft
    INNER JOIN merchant_brands mb
      ON ft.merchant_normalized = mb.merchant_normalized
    WHERE ft.agent_instance_id = ${agentInstanceId}
      AND ft.category = 'subscription'
      AND ft.transaction_date >= ${month}::date
      AND ft.transaction_date < (${month}::date + INTERVAL '1 month')
      AND NOT EXISTS (
        SELECT 1 FROM finance_transactions earlier
        WHERE earlier.agent_instance_id = ft.agent_instance_id
          AND earlier.merchant_normalized = ft.merchant_normalized
          AND earlier.transaction_date < ${month}::date
      )
    LIMIT 5
  `);
  if (newSubs.length > 0) {
    ranked.push({
      type: "new_subscription",
      brands: newSubs.map((r) => r.display_name).filter(Boolean),
    });
  }

  // 4. Potentially cancelled subscriptions — recurring brand with no
  //    charge this month BUT charged in the prior month.
  const cancelled = await db.execute<{ display_name: string }>(sql`
    SELECT DISTINCT mb.display_name
    FROM finance_transactions ft
    INNER JOIN merchant_brands mb
      ON ft.merchant_normalized = mb.merchant_normalized
    WHERE ft.agent_instance_id = ${agentInstanceId}
      AND ft.category = 'subscription'
      AND ft.transaction_date >= ${prevMonth}::date
      AND ft.transaction_date < (${prevMonth}::date + INTERVAL '1 month')
      AND NOT EXISTS (
        SELECT 1 FROM finance_transactions later
        WHERE later.agent_instance_id = ft.agent_instance_id
          AND later.merchant_normalized = ft.merchant_normalized
          AND later.transaction_date >= ${month}::date
          AND later.transaction_date < (${month}::date + INTERVAL '1 month')
      )
    LIMIT 5
  `);
  if (cancelled.length > 0) {
    ranked.push({
      type: "potentially_cancelled_subscription",
      brands: cancelled.map((r) => r.display_name).filter(Boolean),
    });
  }

  // 5. Top category mover (MoM). Skip categories that are <$50 to avoid
  //    "Gifts up 800%" when going from $5 to $45.
  if (prevTotal !== null) {
    const movers = await db.execute<{
      category: string;
      cur: string;
      prev: string;
    }>(sql`
      WITH cur AS (
        SELECT category, ABS(SUM(amount::numeric)) AS total
        FROM finance_transactions
        WHERE agent_instance_id = ${agentInstanceId}
          AND category IS NOT NULL
          AND transaction_date >= ${month}::date
          AND transaction_date < (${month}::date + INTERVAL '1 month')
        GROUP BY category
      ),
      prev AS (
        SELECT category, ABS(SUM(amount::numeric)) AS total
        FROM finance_transactions
        WHERE agent_instance_id = ${agentInstanceId}
          AND category IS NOT NULL
          AND transaction_date >= ${prevMonth}::date
          AND transaction_date < (${prevMonth}::date + INTERVAL '1 month')
        GROUP BY category
      )
      SELECT
        COALESCE(cur.category, prev.category) AS category,
        COALESCE(cur.total, 0)::text AS cur,
        COALESCE(prev.total, 0)::text AS prev
      FROM cur
      FULL OUTER JOIN prev USING (category)
      WHERE COALESCE(cur.category, prev.category) NOT IN ('income', 'internal_transfer')
        AND GREATEST(COALESCE(cur.total, 0), COALESCE(prev.total, 0)) >= 50
    `);
    let bestDelta = 0;
    let best: { category: string; cur: number; prev: number } | null = null;
    for (const m of movers) {
      const cur = parseFloat(m.cur);
      const prev = parseFloat(m.prev);
      if (prev === 0) continue;
      const dp = ((cur - prev) / prev) * 100;
      if (Math.abs(dp) > Math.abs(bestDelta)) {
        bestDelta = dp;
        best = { category: m.category, cur, prev };
      }
    }
    if (best && Math.abs(bestDelta) >= 25) {
      ranked.push({
        type: "category_mover",
        category: best.category,
        deltaPercent: Math.round(bestDelta),
        from: Math.round(best.prev * 100) / 100,
        to: Math.round(best.cur * 100) / 100,
      });
    }
  }

  return { ranked };
}

export async function computeAllTimeSignals(
  numbers: BriefNumbers,
): Promise<BriefSignals> {
  const ranked: Signal[] = [];
  if (numbers.income > 0) {
    const delta = numbers.income - numbers.outflow;
    const pct = Math.round((Math.abs(delta) / numbers.income) * 100);
    if (delta > 50) ranked.push({ type: "surplus", percent: pct, amount: delta });
    else if (delta < -50)
      ranked.push({ type: "deficit", percent: pct, amount: Math.abs(delta) });
    else ranked.push({ type: "break_even" });
  } else {
    ranked.push({ type: "no_income" });
  }
  return { ranked };
}

// ─── Helpers ─────────────────────────────────────────────────────

async function monthOutflow(
  agentInstanceId: string,
  month: string,
): Promise<number | null> {
  const rows = await db.execute<{ has: boolean; total: string | null }>(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM finance_transactions
        WHERE agent_instance_id = ${agentInstanceId}
          AND transaction_date >= ${month}::date
          AND transaction_date < (${month}::date + INTERVAL '1 month')
      ) AS has,
      ABS(SUM(amount::numeric))::text AS total
    FROM finance_transactions
    WHERE agent_instance_id = ${agentInstanceId}
      AND transaction_date >= ${month}::date
      AND transaction_date < (${month}::date + INTERVAL '1 month')
      AND category IS NOT NULL
      AND category NOT IN ('income', 'internal_transfer')
  `);
  if (!rows[0]?.has) return null;
  return rows[0].total ? parseFloat(rows[0].total) : 0;
}

function shiftMonth(month: string, delta: number): string {
  // month = "YYYY-MM-01" → output same shape, shifted.
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

function formatMonthLabel(month: string): string {
  const d = new Date(month + "T00:00:00Z");
  return d.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * List complete months (with data) for a given instance, newest first.
 * Excludes the current in-progress month so the brief page only shows
 * finished periods. Returns array of "YYYY-MM-01" strings.
 */
export async function listAvailableMonths(
  agentInstanceId: string,
): Promise<string[]> {
  const rows = await db.execute<{ month: string }>(sql`
    SELECT DISTINCT TO_CHAR(DATE_TRUNC('month', transaction_date), 'YYYY-MM-DD') AS month
    FROM finance_transactions
    WHERE agent_instance_id = ${agentInstanceId}
      AND category IS NOT NULL
      AND DATE_TRUNC('month', transaction_date) < DATE_TRUNC('month', CURRENT_DATE)
    ORDER BY month DESC
  `);
  return rows.map((r) => r.month);
}

/**
 * Return the latest transaction_date inside the given month, used as the
 * cache-validity stamp. For "all" mode we use the latest txn anywhere.
 */
export async function latestTxnDateForScope(
  agentInstanceId: string,
  month: string | null,
): Promise<string | null> {
  const rows = await db.execute<{ d: string | null }>(
    month
      ? sql`
        SELECT MAX(transaction_date)::text AS d
        FROM finance_transactions
        WHERE agent_instance_id = ${agentInstanceId}
          AND transaction_date >= ${month}::date
          AND transaction_date < (${month}::date + INTERVAL '1 month')
      `
      : sql`
        SELECT MAX(transaction_date)::text AS d
        FROM finance_transactions
        WHERE agent_instance_id = ${agentInstanceId}
      `,
  );
  return rows[0]?.d ?? null;
}
