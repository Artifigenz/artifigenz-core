import { normalizeMerchant, daysBetween, addDays } from "./transaction-normalizer";

export interface TxInput {
  id: string;
  transactionDate: string; // YYYY-MM-DD
  merchantName: string | null;
  description: string;
  amount: number;
  accountName: string | null;
  category: string | null;
}

/**
 * Plaid categories that should NEVER be considered subscriptions.
 * Plaid uses UPPER_SNAKE_CASE for category.primary.
 */
const NON_SUBSCRIPTION_CATEGORIES = new Set([
  "FOOD_AND_DRINK",
  "TRAVEL",
  "GENERAL_MERCHANDISE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "INCOME",
  "MEDICAL",
]);

/**
 * Patterns that indicate bank transfers (not subscriptions).
 * These bypass Plaid's category as "OTHER" but are clearly transfers.
 */
const TRANSFER_PATTERNS = [
  /^pts\b/i,           // Personal Transfer Service (TD Bank)
  /\bpts\s+(to|frm):/i, // PTS TO: or PTS FRM:
  /\be-?t(fr|ransfer)\b/i, // E-TFR, E-TRANSFER
  /\btfr[-\s]?(to|from)\b/i, // TFR-TO, TFR FROM
  /\batm\s+w\/d\b/i,   // ATM Withdrawal
  /\bwithdrawal\s+free\b/i, // Withdrawal Free
  /\binterac\s+e-?transfer\b/i, // Interac e-Transfer
  /\bdeposit\s+\(pac\)/i, // Pre-authorized contribution
  /\bcustomer\s+transfer\b/i, // Customer Transfer
  /\binvestment\s+purchase\b/i, // Investment Purchase
  /\bmortgage\s+payment\b/i, // Mortgage Payment
  /\bbill\s+payment\b/i, // Bill Payment (utility bills, not subscriptions)
];

/**
 * Check if a transaction looks like a bank transfer based on description/merchant.
 */
function looksLikeTransfer(merchantName: string | null, description: string): boolean {
  const text = `${merchantName ?? ""} ${description}`.toLowerCase();
  return TRANSFER_PATTERNS.some((pattern) => pattern.test(text));
}

export type Frequency = "weekly" | "monthly" | "quarterly" | "annual";

export interface DetectedSubscription {
  merchantName: string;
  amount: number;
  frequency: Frequency;
  lastChargeDate: string;
  nextChargeDate: string;
  accountName: string | null;
  transactionCount: number;
  amountHistory: number[];
}

// Known frequency patterns: [name, minDays, maxDays, idealDays]
const FREQUENCIES: Array<[Frequency, number, number, number]> = [
  ["weekly", 6, 8, 7],
  ["monthly", 26, 33, 30],
  ["quarterly", 85, 95, 90],
  ["annual", 355, 375, 365],
];

/**
 * Detects recurring subscriptions from a list of transactions.
 *
 * Algorithm:
 * 1. Filter to outgoing charges (positive amounts)
 * 2. Group by (normalized merchant + account)
 * 3. For each group with 2+ charges:
 *    a. Sort by date
 *    b. Compute gaps between consecutive charges
 *    c. If gaps consistently match a known frequency, mark as recurring
 *    d. Allow 5% amount variance (handles price increases)
 */
export function detectRecurring(transactions: TxInput[]): DetectedSubscription[] {
  // Group by normalized merchant + account
  const groups = new Map<string, TxInput[]>();

  for (const tx of transactions) {
    if (tx.amount <= 0) continue; // Skip refunds/deposits
    if (tx.category && NON_SUBSCRIPTION_CATEGORIES.has(tx.category)) continue;
    if (looksLikeTransfer(tx.merchantName, tx.description)) continue; // Skip transfers

    const merchantKey = normalizeMerchant(tx.merchantName ?? tx.description);
    if (!merchantKey) continue;

    const key = `${merchantKey}::${tx.accountName ?? ""}`;
    const existing = groups.get(key) ?? [];
    existing.push(tx);
    groups.set(key, existing);
  }

  const detected: DetectedSubscription[] = [];

  for (const [, txs] of groups.entries()) {
    // Require at least 3 occurrences to claim a recurring pattern
    if (txs.length < 3) continue;

    // Sort oldest → newest
    const sorted = [...txs].sort((a, b) =>
      a.transactionDate.localeCompare(b.transactionDate),
    );

    // Compute gaps between consecutive transactions
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i - 1].transactionDate, sorted[i].transactionDate));
    }

    // Find which frequency matches
    const frequency = identifyFrequency(gaps);
    if (!frequency) continue;

    // Check amount consistency (within 5% of median)
    const amounts = sorted.map((t) => t.amount);
    const median = amounts.slice().sort((a, b) => a - b)[Math.floor(amounts.length / 2)];
    const consistent = amounts.every(
      (a) => Math.abs(a - median) / median <= 0.05,
    );
    if (!consistent) continue;

    const last = sorted[sorted.length - 1];
    const idealDays = FREQUENCIES.find((f) => f[0] === frequency)![3];
    const latestAmount = last.amount;

    detected.push({
      merchantName: normalizeMerchant(last.merchantName ?? last.description),
      amount: latestAmount,
      frequency,
      lastChargeDate: last.transactionDate,
      nextChargeDate: addDays(last.transactionDate, idealDays),
      accountName: last.accountName,
      transactionCount: sorted.length,
      amountHistory: amounts,
    });
  }

  return detected;
}

/**
 * Given a list of gaps (in days), determine which frequency they represent.
 * Returns null if no consistent frequency is detected.
 */
function identifyFrequency(gaps: number[]): Frequency | null {
  if (gaps.length === 0) return null;

  for (const [name, minDays, maxDays] of FREQUENCIES) {
    const allInRange = gaps.every((g) => g >= minDays && g <= maxDays);
    if (allInRange) return name;
  }

  return null;
}
