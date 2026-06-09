import { and, eq, sql } from "drizzle-orm";
import {
  db,
  financeAccounts,
  financeTransactions,
} from "@artifigenz/db";
import type {
  SkillDefinition,
  InsightOutput,
} from "../../../platform/registry/types";

/**
 * Daily Pulse — runs every morning in the user's local timezone and
 * produces ONE insight covering three things:
 *
 *   1. Current balance across the user's connected accounts.
 *   2. What happened in the account YESTERDAY — count, total, top
 *      categories. Internal transfers excluded so the user sees actual
 *      activity, not noise.
 *   3. What's EXPECTED to happen today. Strict prediction: we only
 *      surface a charge if its brand has a tight cadence (variance < 5%
 *      AND 3+ historical charges AND a standard cadence) AND today is
 *      inside the predicted ±1-day window. Single-charge or noisy brands
 *      stay out — wrong predictions kill trust faster than missing ones.
 *
 * Scheduling: cron pattern is hourly. Per-user TZ would mean per-user
 * cron jobs in the scheduler; for v1 the skill itself checks the user's
 * local hour and no-ops outside the 8am window. Cheap (one DB read) and
 * sidesteps a scheduler refactor for the first skill.
 *
 * Idempotency: skill state records the last date the pulse was produced
 * (in user local time). If we already fired today, skip — the hourly
 * cron may tick 8am-ish twice on DST days, and bullmq can retry.
 */

interface SkillState {
  lastRunDate?: string; // YYYY-MM-DD in user's TZ
}

const TARGET_HOUR = 8;

export const dailyPulseSkill: SkillDefinition = {
  id: "finance.daily-pulse",
  name: "Daily Pulse",
  description:
    "Every morning at 8am, a single-sentence pulse of your accounts: balance, what hit yesterday, what's expected today.",
  agentTypeId: "finance",

  triggers: {
    schedule: "0 * * * *", // every hour at :00; TZ gate inside analyze
    events: [],
  },

  insightTypes: [
    {
      id: "finance.daily-pulse.morning",
      name: "Daily Pulse",
      critical: false,
      deliveryChannels: ["in_app"],
    },
  ],

  async analyze(ctx): Promise<InsightOutput[]> {
    const tz = ctx.user.timezone || "UTC";

    // Hour gate. The cron fires hourly; we only generate at 8am LOCAL.
    // DAILY_PULSE_BYPASS_HOUR=1 lets us trigger the skill in dev without
    // waiting for the actual hour. Never set in production.
    const nowParts = partsInTimezone(new Date(), tz);
    const bypassHour = process.env.DAILY_PULSE_BYPASS_HOUR === "1";
    if (!bypassHour && nowParts.hour !== TARGET_HOUR) return [];

    // Daily idempotency. lastRunDate stored as YYYY-MM-DD in user TZ.
    // Bypass also defeats this so a manual re-run during dev produces
    // a fresh insight rather than silently no-op-ing.
    const state = (await ctx.getSkillState<SkillState>()) ?? {};
    const todayKey = nowParts.dateKey;
    if (!bypassHour && state.lastRunDate === todayKey) return [];

    const { agentInstance } = ctx;

    // 1. Balance ── sum currentBalance across the user's accounts.
    //    Account balances can be NULL if Plaid hasn't synced them yet
    //    (e.g., file-upload-only). In that case we skip the balance line
    //    rather than guess.
    const accounts = await db
      .select({
        id: financeAccounts.id,
        name: financeAccounts.name,
        balance: financeAccounts.currentBalance,
        last4: financeAccounts.accountLast4,
        currency: financeAccounts.isoCurrencyCode,
      })
      .from(financeAccounts)
      .where(eq(financeAccounts.agentInstanceId, agentInstance.id));

    const knownBalances = accounts.filter(
      (a) => a.balance !== null && a.balance !== undefined,
    );
    const balanceTotal = knownBalances.reduce(
      (sum, a) => sum + parseFloat(a.balance as string),
      0,
    );

    // 2. Yesterday recap. "Yesterday" = the calendar day before today, in
    //    the user's TZ. We exclude internal transfers since they're a
    //    wash, and group by category for the description.
    const yesterdayKey = shiftDateKey(todayKey, -1);

    const yesterdayRows = await db.execute<{
      category: string | null;
      n: number;
      total: string;
      display_name: string | null;
      brand_total: string;
    }>(sql`
      WITH base AS (
        SELECT
          ft.category,
          ft.amount,
          mb.display_name
        FROM finance_transactions ft
        LEFT JOIN merchant_brands mb
          ON ft.merchant_normalized = mb.merchant_normalized
        WHERE ft.agent_instance_id = ${agentInstance.id}
          AND ft.transaction_date = ${yesterdayKey}::date
          AND ft.direction = 'out'
          AND (ft.category IS NULL OR ft.category <> 'internal_transfer')
      )
      SELECT
        category,
        COUNT(*)::int AS n,
        ABS(SUM(amount::numeric))::text AS total,
        NULL::text AS display_name,
        NULL::text AS brand_total
      FROM base
      GROUP BY category
      ORDER BY ABS(SUM(amount::numeric)) DESC
    `);

    let yesterdayCount = 0;
    let yesterdayTotal = 0;
    const yesterdayByCategory: Array<{
      category: string;
      total: number;
      count: number;
    }> = [];
    for (const r of yesterdayRows) {
      yesterdayCount += r.n;
      const t = parseFloat(r.total);
      yesterdayTotal += t;
      if (r.category) {
        yesterdayByCategory.push({
          category: r.category,
          total: Math.round(t * 100) / 100,
          count: r.n,
        });
      }
    }

    // Top yesterday merchants (for richer copy when there's room).
    const yesterdayTopBrands = await db.execute<{
      display_name: string | null;
      total: string;
    }>(sql`
      SELECT
        mb.display_name,
        ABS(SUM(ft.amount::numeric))::text AS total
      FROM finance_transactions ft
      LEFT JOIN merchant_brands mb
        ON ft.merchant_normalized = mb.merchant_normalized
      WHERE ft.agent_instance_id = ${agentInstance.id}
        AND ft.transaction_date = ${yesterdayKey}::date
        AND ft.direction = 'out'
        AND (ft.category IS NULL OR ft.category <> 'internal_transfer')
        AND mb.display_name IS NOT NULL
      GROUP BY mb.display_name
      ORDER BY ABS(SUM(ft.amount::numeric)) DESC
      LIMIT 3
    `);

    // 3. Today's expected charges. Strict criteria — only brands we trust
    //    to recur predictably. We compute, per brand:
    //      - count                      (>= 3)
    //      - avg_gap (days between distinct charge dates)
    //      - amount variance (stddev / avg)
    //      - last_date
    //    Then we accept the brand if:
    //      - variance < 5%
    //      - avg_gap matches a standard cadence (we require it to round
    //        to one of: 7, 14, 30, 90, 365 within a tight window)
    //      - the predicted next date (last_date + avg_gap) falls within
    //        ±1 day of today
    const todayRows = await db.execute<{
      brand_slug: string;
      display_name: string;
      avg_amount: string;
      variance_pct: number;
      avg_gap: number;
      last_date: string;
      expected_date: string;
      days_until: number;
    }>(sql`
      WITH brand_stats AS (
        SELECT
          mb.brand_slug,
          MAX(mb.display_name) AS display_name,
          AVG(ABS(ft.amount::numeric))::text AS avg_amount_text,
          COALESCE(
            STDDEV_SAMP(ABS(ft.amount::numeric)) / NULLIF(AVG(ABS(ft.amount::numeric)), 0),
            0
          )::numeric AS variance_ratio,
          (MAX(ft.transaction_date) - MIN(ft.transaction_date))::int AS span_days,
          COUNT(DISTINCT ft.transaction_date)::int AS distinct_dates,
          COUNT(*)::int AS n,
          MAX(ft.transaction_date) AS last_date
        FROM finance_transactions ft
        INNER JOIN merchant_brands mb
          ON ft.merchant_normalized = mb.merchant_normalized
        WHERE ft.agent_instance_id = ${agentInstance.id}
          AND ft.direction = 'out'
          AND ft.category IN ('subscription', 'loan_emi', 'variable_recurring')
          AND mb.brand_slug IS NOT NULL
        GROUP BY mb.brand_slug
        HAVING COUNT(*) >= 3
      )
      SELECT
        brand_slug,
        display_name,
        avg_amount_text AS avg_amount,
        (variance_ratio * 100)::int AS variance_pct,
        CASE
          WHEN distinct_dates > 1 THEN ROUND(span_days::numeric / (distinct_dates - 1))::int
          ELSE 0
        END AS avg_gap,
        last_date::text,
        (last_date + (
          CASE
            WHEN distinct_dates > 1 THEN ROUND(span_days::numeric / (distinct_dates - 1))::int
            ELSE 0
          END
        ))::text AS expected_date,
        ((last_date + (
          CASE
            WHEN distinct_dates > 1 THEN ROUND(span_days::numeric / (distinct_dates - 1))::int
            ELSE 0
          END
        )) - ${todayKey}::date)::int AS days_until
      FROM brand_stats
      WHERE variance_ratio < 0.05
      ORDER BY ABS(((last_date + (
        CASE
          WHEN distinct_dates > 1 THEN ROUND(span_days::numeric / (distinct_dates - 1))::int
          ELSE 0
        END
      )) - ${todayKey}::date))
      LIMIT 10
    `);

    // Standard cadence gate + ±1-day window.
    const STANDARD_GAPS = [7, 14, 30, 31, 90, 91, 92, 365, 366];
    const expectedToday = todayRows
      .filter((r) => Math.abs(r.days_until) <= 1)
      .filter((r) =>
        STANDARD_GAPS.some((g) => Math.abs(g - r.avg_gap) <= 1),
      )
      .slice(0, 5)
      .map((r) => ({
        brandSlug: r.brand_slug,
        displayName: r.display_name,
        amount: Math.round(parseFloat(r.avg_amount) * 100) / 100,
        expectedDate: r.expected_date,
      }));
    const expectedTotal = expectedToday.reduce((s, e) => s + e.amount, 0);

    // ── Compose copy ──────────────────────────────────────────────
    const currency = (knownBalances[0]?.currency as string | null) ?? "USD";
    const money = (n: number) => formatMoney(n, currency);

    const balancePart =
      knownBalances.length > 0
        ? `Balance ${money(balanceTotal)} across ${knownBalances.length} account${
            knownBalances.length === 1 ? "" : "s"
          }`
        : "Balance: not yet synced";

    const yesterdayPart =
      yesterdayCount > 0
        ? `Yesterday: ${yesterdayCount} charge${yesterdayCount === 1 ? "" : "s"} totaling ${money(
            yesterdayTotal,
          )}${
            yesterdayTopBrands.length > 0
              ? ` (${yesterdayTopBrands
                  .map((b) => b.display_name)
                  .filter(Boolean)
                  .join(", ")})`
              : ""
          }`
        : "Yesterday was quiet — no out-flow activity";

    const todayPart =
      expectedToday.length > 0
        ? `Today: ${expectedToday.length} charge${expectedToday.length === 1 ? "" : "s"} expected (${money(
            expectedTotal,
          )}) — ${expectedToday.map((e) => e.displayName).join(", ")}`
        : "Today: nothing predictable on the calendar";

    const title = `${formatDayLabel(todayKey)} · ${balancePart}`;
    const description = `${yesterdayPart}. ${todayPart}.`;

    const out: InsightOutput = {
      insightTypeId: "finance.daily-pulse.morning",
      title,
      description,
      data: {
        date: todayKey,
        timezone: tz,
        balance: {
          total: Math.round(balanceTotal * 100) / 100,
          currency,
          accounts: knownBalances.map((a) => ({
            id: a.id,
            name: a.name,
            last4: a.last4,
            balance: Math.round(parseFloat(a.balance as string) * 100) / 100,
          })),
        },
        yesterday: {
          date: yesterdayKey,
          count: yesterdayCount,
          total: Math.round(yesterdayTotal * 100) / 100,
          byCategory: yesterdayByCategory,
          topBrands: yesterdayTopBrands.map((b) => ({
            displayName: b.display_name,
            total: Math.round(parseFloat(b.total) * 100) / 100,
          })),
        },
        today: {
          expected: expectedToday,
          expectedTotal: Math.round(expectedTotal * 100) / 100,
        },
      },
      critical: false,
    };

    await ctx.setSkillState<SkillState>({ lastRunDate: todayKey });

    return [out];
  },
};

// ─── Helpers ─────────────────────────────────────────────────────

function partsInTimezone(d: Date, tz: string): { hour: number; dateKey: string } {
  // Intl.DateTimeFormat with the user's TZ gives us the local wall clock.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) =>
    parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10);
  // "en-CA" gives ISO-style YYYY-MM-DD ordering.
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  return { hour, dateKey };
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Use UTC to do clean date math — we just want a calendar shift.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatMoney(n: number, currency: string): string {
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    // Fallback if currency code is exotic / unknown.
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }
}
