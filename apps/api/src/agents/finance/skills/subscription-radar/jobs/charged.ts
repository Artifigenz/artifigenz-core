import type { SubscriptionInsight } from "../index";

interface RecurringStream {
  plaidStreamId: string;
  merchantName: string | null;
  averageAmount: string;
  plaidAccountId: string | null;
}

interface Transaction {
  merchantName: string | null;
  amount: string;
  transactionDate: string;
  plaidAccountId: string | null;
}

interface Account {
  plaidAccountId: string;
  name: string | null;
  mask: string | null;
  type: string | null;
}

function formatMoney(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

function getAccountLabel(
  plaidAccountId: string | null,
  accountMap: Map<string, Account>,
): string {
  if (!plaidAccountId) return "";
  const account = accountMap.get(plaidAccountId);
  if (!account) return "";
  const type = account.type === "credit" ? "Card" : "Account";
  const mask = account.mask ? `••${account.mask}` : "";
  return mask ? `${type} ${mask}` : type;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) {
    return "this morning";
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return "yesterday";
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

/**
 * Detect subscriptions that charged as expected (low priority confirmation).
 * Only generates insights for charges that match expected amount (no price change).
 */
export function detectCharged(
  streams: RecurringStream[],
  recentTransactions: Transaction[],
  accountMap: Map<string, Account>,
): SubscriptionInsight[] {
  const insights: SubscriptionInsight[] = [];

  // Group transactions by merchant (normalized)
  const txByMerchant = new Map<string, Transaction[]>();
  for (const tx of recentTransactions) {
    if (!tx.merchantName) continue;
    const key = tx.merchantName.toLowerCase();
    const list = txByMerchant.get(key) ?? [];
    list.push(tx);
    txByMerchant.set(key, list);
  }

  for (const stream of streams) {
    if (!stream.merchantName) continue;
    const merchantKey = stream.merchantName.toLowerCase();
    const txs = txByMerchant.get(merchantKey);
    if (!txs || txs.length === 0) continue;

    // Get the most recent transaction for this merchant
    const latestTx = txs.sort(
      (a, b) => b.transactionDate.localeCompare(a.transactionDate),
    )[0];

    const expectedAmount = Math.abs(parseFloat(stream.averageAmount));
    const actualAmount = Math.abs(parseFloat(latestTx.amount));

    // Only report if amount matches (within 5% and $1)
    const diff = Math.abs(actualAmount - expectedAmount);
    const percentChange = (diff / expectedAmount) * 100;

    if (percentChange > 5 && diff > 1) continue; // This is a price change, handled elsewhere

    const merchant = stream.merchantName;
    const accountLabel = getAccountLabel(latestTx.plaidAccountId, accountMap);

    insights.push({
      insightTypeId: "subscription-radar.charged",
      title: `${merchant} charged ${formatMoney(actualAmount)} — as expected`,
      description: `${accountLabel ? `${accountLabel} · ` : ""}Posted ${formatRelativeDate(latestTx.transactionDate)}. No change from last month.`,
      critical: false,
      data: {
        streamId: stream.plaidStreamId,
        merchantName: merchant,
        amount: actualAmount,
        transactionDate: latestTx.transactionDate,
        accountId: latestTx.plaidAccountId,
      },
    });
  }

  return insights;
}
