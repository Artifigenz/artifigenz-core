import type { Digest, BalancePoint } from "./types";

export interface VerdictDimensions {
  // Cash Position
  leftoverMonthly: number;
  marginPercent: number;
  surplusOrDeficit: "surplus" | "deficit" | "breakeven";

  // Fixed Load
  recurringMonthly: number;
  recurringPercent: number;

  // Stress Signals
  negativeBalanceDays: number;
  nsfCount: number;
  hasStressSignals: boolean;

  // Trend
  trend: "improving" | "stable" | "declining";
  trendDetail: string | null;

  // Root Cause
  biggestRecurring: {
    name: string;
    amount: number;
    percentOfIncome: number;
  } | null;
  biggestDiscretionary: {
    name: string;
    amount: number;
  } | null;

  // Buffer
  currentBalance: number;
  runwayDays: number;

  // Context
  incomeMonthly: number;
  daysOfData: number;
  accountsCount: number;
}

/**
 * Compute the trend direction from a balance series.
 * Compares the average of the last 14 days vs the previous 14 days.
 */
function computeTrend(
  balanceSeries: BalancePoint[],
): { trend: "improving" | "stable" | "declining"; detail: string | null } {
  if (balanceSeries.length < 28) {
    return { trend: "stable", detail: "Not enough data to determine trend" };
  }

  // Balance series is oldest first, so recent is at the end
  const recent14 = balanceSeries.slice(-14);
  const previous14 = balanceSeries.slice(-28, -14);

  const recentAvg =
    recent14.reduce((sum, p) => sum + p.balance, 0) / recent14.length;
  const previousAvg =
    previous14.reduce((sum, p) => sum + p.balance, 0) / previous14.length;

  const changePercent = ((recentAvg - previousAvg) / Math.abs(previousAvg || 1)) * 100;

  if (changePercent > 5) {
    return {
      trend: "improving",
      detail: `Balance up ${Math.abs(changePercent).toFixed(0)}% vs previous 2 weeks`,
    };
  } else if (changePercent < -5) {
    return {
      trend: "declining",
      detail: `Balance down ${Math.abs(changePercent).toFixed(0)}% vs previous 2 weeks`,
    };
  }
  return { trend: "stable", detail: null };
}

/**
 * Compute the current net balance from the latest balance series point.
 */
function getCurrentBalance(balanceSeries: BalancePoint[]): number {
  if (balanceSeries.length === 0) return 0;
  // Balance series is oldest first, so most recent is last
  return balanceSeries[balanceSeries.length - 1].balance;
}

/**
 * Compute runway in days: current balance / daily spend rate.
 */
function computeRunwayDays(
  currentBalance: number,
  expensesMonthly: number,
): number {
  if (expensesMonthly <= 0) return 999; // No expenses = infinite runway
  if (currentBalance <= 0) return 0;
  const dailySpend = expensesMonthly / 30;
  return Math.round(currentBalance / dailySpend);
}

/**
 * Extract verdict dimensions from the digest.
 * These dimensions are passed to the LLM to generate the verdict.
 */
export function extractVerdictDimensions(digest: Digest): VerdictDimensions {
  // Cash Position
  const marginPercent =
    digest.income_monthly > 0
      ? (digest.leftover_monthly / digest.income_monthly) * 100
      : 0;

  let surplusOrDeficit: "surplus" | "deficit" | "breakeven" = "breakeven";
  if (digest.leftover_monthly > 50) surplusOrDeficit = "surplus";
  else if (digest.leftover_monthly < -50) surplusOrDeficit = "deficit";

  // Fixed Load
  const recurringPercent =
    digest.income_monthly > 0
      ? (digest.recurring_monthly / digest.income_monthly) * 100
      : 0;

  // Stress Signals
  const hasStressSignals =
    digest.risk_flags.negative_balance_days > 7 ||
    digest.risk_flags.nsf_count > 0;

  // Trend
  const { trend, detail: trendDetail } = computeTrend(digest.balance_series);

  // Root Cause - Biggest Recurring
  let biggestRecurring: VerdictDimensions["biggestRecurring"] = null;
  if (digest.outflow_streams.length > 0) {
    const sorted = [...digest.outflow_streams].sort(
      (a, b) => b.amount_monthly - a.amount_monthly,
    );
    const top = sorted[0];
    biggestRecurring = {
      name: top.merchant,
      amount: top.amount_monthly,
      percentOfIncome:
        digest.income_monthly > 0
          ? (top.amount_monthly / digest.income_monthly) * 100
          : 0,
    };
  }

  // Root Cause - Biggest Discretionary (from top merchants, non-recurring)
  let biggestDiscretionary: VerdictDimensions["biggestDiscretionary"] = null;
  if (digest.top_merchants.length > 0) {
    const top = digest.top_merchants[0];
    biggestDiscretionary = {
      name: top.merchant,
      amount: top.total,
    };
  }

  // Buffer
  const currentBalance = getCurrentBalance(digest.balance_series);
  const runwayDays = computeRunwayDays(currentBalance, digest.expenses_monthly);

  return {
    // Cash Position
    leftoverMonthly: digest.leftover_monthly,
    marginPercent,
    surplusOrDeficit,

    // Fixed Load
    recurringMonthly: digest.recurring_monthly,
    recurringPercent,

    // Stress Signals
    negativeBalanceDays: digest.risk_flags.negative_balance_days,
    nsfCount: digest.risk_flags.nsf_count,
    hasStressSignals,

    // Trend
    trend,
    trendDetail,

    // Root Cause
    biggestRecurring,
    biggestDiscretionary,

    // Buffer
    currentBalance,
    runwayDays,

    // Context
    incomeMonthly: digest.income_monthly,
    daysOfData: digest.days_of_data,
    accountsCount: digest.accounts_count,
  };
}
