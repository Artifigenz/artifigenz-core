import type { SubscriptionInsight } from "../index";

interface RecurringStream {
  plaidStreamId: string;
  merchantName: string | null;
  averageAmount: string;
  predictedNextDate: string | null;
  plaidAccountId: string | null;
  frequency: string;
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

/**
 * Detect subscriptions charging TODAY.
 */
export function detectUpcoming(
  streams: RecurringStream[],
  accountMap: Map<string, Account>,
  today: string,
): SubscriptionInsight[] {
  const insights: SubscriptionInsight[] = [];

  for (const stream of streams) {
    if (stream.predictedNextDate !== today) continue;

    const amount = Math.abs(parseFloat(stream.averageAmount));
    const merchant = stream.merchantName ?? "Unknown";
    const accountLabel = getAccountLabel(stream.plaidAccountId, accountMap);

    insights.push({
      insightTypeId: "subscription-radar.upcoming",
      title: `${merchant} will charge ${formatMoney(amount)} today`,
      description: accountLabel ? `${accountLabel} · auto-renew` : "Auto-renew",
      critical: false,
      data: {
        streamId: stream.plaidStreamId,
        merchantName: merchant,
        amount,
        accountId: stream.plaidAccountId,
        chargeDate: today,
      },
    });
  }

  return insights;
}
