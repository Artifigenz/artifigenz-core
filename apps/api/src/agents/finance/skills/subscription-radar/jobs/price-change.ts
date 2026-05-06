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

/**
 * Detect price changes (recent transaction differs from stream average by >5%).
 */
export function detectPriceChange(
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

    // Check for significant change (>5% or >$1 difference)
    const diff = actualAmount - expectedAmount;
    const percentChange = Math.abs(diff / expectedAmount) * 100;

    if (percentChange < 5 || Math.abs(diff) < 1) continue;

    const direction = diff > 0 ? "increased" : "decreased";
    const merchant = stream.merchantName;

    insights.push({
      insightTypeId: "subscription-radar.price-change",
      title: `${merchant} ${direction} ${formatMoney(expectedAmount)} → ${formatMoney(actualAmount)}`,
      description: diff > 0
        ? `Up ${formatMoney(diff)} from your usual rate`
        : `Down ${formatMoney(Math.abs(diff))} from your usual rate`,
      critical: true,
      data: {
        streamId: stream.plaidStreamId,
        merchantName: merchant,
        previousAmount: expectedAmount,
        newAmount: actualAmount,
        difference: diff,
        percentChange,
        transactionDate: latestTx.transactionDate,
      },
    });
  }

  return insights;
}
