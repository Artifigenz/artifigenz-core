import type { Digest, BalancePoint, TopMerchant, StreamSummary } from "./types";

export interface TimingDimension {
  paydayToMonthEndDropPercent: number | null;
  lowestBalanceDay: number | null; // Day of month (1-31)
  lowestBalanceAmount: number | null;
  pattern: string | null; // "sharp decline final week", "steady throughout", etc.
}

export interface ConcentrationDimension {
  top3Percent: number; // Top 3 merchants as % of total discretionary
  biggestMerchant: { name: string; amount: number; count: number } | null;
  merchantCount: number; // Total unique merchants
}

export interface DriftDimension {
  newSubscriptionCount: number;
  newRecurringMonthly: number;
  recentAdditions: string[]; // Names of new subscriptions
}

export interface RiskDimension {
  negativeBalanceDays: number;
  nsfCount: number;
  interestChargesMonthly: number | null; // Detected interest/finance charges
  severity: "none" | "mild" | "moderate" | "severe";
}

export interface CompositionDimension {
  incomeSourceCount: number;
  incomePrimarySource: string | null;
  incomeConcentrationPercent: number; // % from primary source
  recurringStreamCount: number;
  biggestRecurring: { name: string; amount: number; percentOfIncome: number } | null;
}

export interface NarrativeDimensions {
  timing: TimingDimension;
  concentration: ConcentrationDimension;
  drift: DriftDimension;
  risk: RiskDimension;
  composition: CompositionDimension;
}

/**
 * Analyze balance series for timing patterns.
 */
function computeTimingDimension(
  balanceSeries: BalancePoint[],
): TimingDimension {
  if (balanceSeries.length < 14) {
    return {
      paydayToMonthEndDropPercent: null,
      lowestBalanceDay: null,
      lowestBalanceAmount: null,
      pattern: null,
    };
  }

  // Find lowest balance point
  let lowestPoint = balanceSeries[0];
  for (const point of balanceSeries) {
    if (point.balance < lowestPoint.balance) {
      lowestPoint = point;
    }
  }
  const lowestBalanceDay = new Date(lowestPoint.date).getUTCDate();
  const lowestBalanceAmount = lowestPoint.balance;

  // Analyze last 30 days for pattern
  const last30 = balanceSeries.slice(-30);
  if (last30.length < 7) {
    return {
      paydayToMonthEndDropPercent: null,
      lowestBalanceDay,
      lowestBalanceAmount,
      pattern: null,
    };
  }

  // Find approximate payday (highest balance point in first 10 days)
  const firstWeek = last30.slice(0, 10);
  let paydayPoint = firstWeek[0];
  for (const point of firstWeek) {
    if (point.balance > paydayPoint.balance) {
      paydayPoint = point;
    }
  }

  // Find month-end (last 3 days)
  const monthEnd = last30.slice(-3);
  const monthEndAvg =
    monthEnd.reduce((sum, p) => sum + p.balance, 0) / monthEnd.length;

  // Calculate drop
  const paydayToMonthEndDropPercent =
    paydayPoint.balance > 0
      ? ((paydayPoint.balance - monthEndAvg) / paydayPoint.balance) * 100
      : null;

  // Determine pattern
  let pattern: string | null = null;
  if (paydayToMonthEndDropPercent !== null) {
    if (paydayToMonthEndDropPercent > 70) {
      pattern = "Sharp decline through the month";
    } else if (paydayToMonthEndDropPercent > 40) {
      pattern = "Gradual decline through the month";
    } else if (paydayToMonthEndDropPercent > 10) {
      pattern = "Moderate spend-down through the month";
    } else {
      pattern = "Relatively steady through the month";
    }
  }

  return {
    paydayToMonthEndDropPercent,
    lowestBalanceDay,
    lowestBalanceAmount,
    pattern,
  };
}

/**
 * Analyze merchant concentration.
 */
function computeConcentrationDimension(
  topMerchants: TopMerchant[],
): ConcentrationDimension {
  if (topMerchants.length === 0) {
    return {
      top3Percent: 0,
      biggestMerchant: null,
      merchantCount: 0,
    };
  }

  const totalSpend = topMerchants.reduce((sum, m) => sum + m.total, 0);
  const top3 = topMerchants.slice(0, 3);
  const top3Spend = top3.reduce((sum, m) => sum + m.total, 0);
  const top3Percent = totalSpend > 0 ? (top3Spend / totalSpend) * 100 : 0;

  const biggest = topMerchants[0];

  return {
    top3Percent,
    biggestMerchant: {
      name: biggest.merchant,
      amount: biggest.total,
      count: biggest.count,
    },
    merchantCount: topMerchants.length,
  };
}

/**
 * Analyze subscription drift.
 */
function computeDriftDimension(
  newRecurringCount: number,
  outflowStreams: StreamSummary[],
): DriftDimension {
  // We don't have firstDate in StreamSummary, so we use the count from digest
  // and estimate monthly amount from recent streams
  // For now, use the new_recurring_count from digest and list recent stream names

  const recentAdditions = outflowStreams.slice(0, newRecurringCount).map((s) => s.merchant);

  // Estimate new recurring monthly (rough: assume they're the last N streams)
  const newRecurringMonthly = outflowStreams
    .slice(0, newRecurringCount)
    .reduce((sum, s) => sum + s.amount_monthly, 0);

  return {
    newSubscriptionCount: newRecurringCount,
    newRecurringMonthly,
    recentAdditions,
  };
}

/**
 * Analyze risk signals.
 */
function computeRiskDimension(
  negativeBalanceDays: number,
  nsfCount: number,
  // Future: could detect interest charges from transactions
): RiskDimension {
  let severity: RiskDimension["severity"] = "none";

  if (negativeBalanceDays > 60 || nsfCount > 3) {
    severity = "severe";
  } else if (negativeBalanceDays > 30 || nsfCount > 1) {
    severity = "moderate";
  } else if (negativeBalanceDays > 7 || nsfCount > 0) {
    severity = "mild";
  }

  return {
    negativeBalanceDays,
    nsfCount,
    interestChargesMonthly: null, // TODO: detect from transactions
    severity,
  };
}

/**
 * Analyze income and recurring composition.
 */
function computeCompositionDimension(
  inflowStreams: StreamSummary[],
  outflowStreams: StreamSummary[],
  incomeMonthly: number,
): CompositionDimension {
  const incomeSourceCount = inflowStreams.length;

  let incomePrimarySource: string | null = null;
  let incomeConcentrationPercent = 0;

  if (inflowStreams.length > 0) {
    // Sort by amount descending
    const sorted = [...inflowStreams].sort(
      (a, b) => b.amount_monthly - a.amount_monthly,
    );
    incomePrimarySource = sorted[0].merchant;
    incomeConcentrationPercent =
      incomeMonthly > 0
        ? (sorted[0].amount_monthly / incomeMonthly) * 100
        : 0;
  }

  let biggestRecurring: CompositionDimension["biggestRecurring"] = null;
  if (outflowStreams.length > 0) {
    const sorted = [...outflowStreams].sort(
      (a, b) => b.amount_monthly - a.amount_monthly,
    );
    biggestRecurring = {
      name: sorted[0].merchant,
      amount: sorted[0].amount_monthly,
      percentOfIncome:
        incomeMonthly > 0
          ? (sorted[0].amount_monthly / incomeMonthly) * 100
          : 0,
    };
  }

  return {
    incomeSourceCount,
    incomePrimarySource,
    incomeConcentrationPercent,
    recurringStreamCount: outflowStreams.length,
    biggestRecurring,
  };
}

/**
 * Extract all narrative dimensions from the digest.
 */
export function extractNarrativeDimensions(digest: Digest): NarrativeDimensions {
  return {
    timing: computeTimingDimension(digest.balance_series),
    concentration: computeConcentrationDimension(digest.top_merchants),
    drift: computeDriftDimension(digest.new_recurring_count, digest.outflow_streams),
    risk: computeRiskDimension(
      digest.risk_flags.negative_balance_days,
      digest.risk_flags.nsf_count,
    ),
    composition: computeCompositionDimension(
      digest.inflow_streams,
      digest.outflow_streams,
      digest.income_monthly,
    ),
  };
}
