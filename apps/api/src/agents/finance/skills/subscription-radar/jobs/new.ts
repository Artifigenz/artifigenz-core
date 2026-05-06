import type { SubscriptionInsight } from "../index";

interface RecurringStream {
  plaidStreamId: string;
  merchantName: string | null;
  averageAmount: string;
  frequency: string;
  firstDate: string | null;
  plaidAccountId: string | null;
}

interface Account {
  plaidAccountId: string;
  name: string | null;
  mask: string | null;
  type: string | null;
}

interface PreviousStream {
  plaidStreamId?: string;
  merchantName?: string;
}

function formatMoney(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

function formatFrequency(freq: string): string {
  const lower = freq.toLowerCase();
  if (lower.includes("month")) return "/mo";
  if (lower.includes("week")) return "/wk";
  if (lower.includes("year") || lower.includes("annual")) return "/yr";
  return "";
}

/**
 * Detect NEW subscriptions (not in previous snapshot).
 */
export function detectNew(
  currentStreams: RecurringStream[],
  previousStreams: unknown[],
  accountMap: Map<string, Account>,
): SubscriptionInsight[] {
  const insights: SubscriptionInsight[] = [];

  // Build set of previous merchant names
  const previousMerchants = new Set(
    (previousStreams as PreviousStream[])
      .map((s) => s.merchantName?.toLowerCase())
      .filter(Boolean),
  );

  for (const stream of currentStreams) {
    const merchantLower = stream.merchantName?.toLowerCase();
    if (!merchantLower) continue;

    // If not in previous snapshot, it's new
    if (previousMerchants.has(merchantLower)) continue;

    const amount = Math.abs(parseFloat(stream.averageAmount));
    const merchant = stream.merchantName ?? "Unknown";
    const freq = formatFrequency(stream.frequency);

    insights.push({
      insightTypeId: "subscription-radar.new",
      title: "New subscription detected",
      description: `${merchant} — ${formatMoney(amount)}${freq}${stream.firstDate ? ` starting ${stream.firstDate}` : ""}`,
      critical: false,
      data: {
        streamId: stream.plaidStreamId,
        merchantName: merchant,
        amount,
        frequency: stream.frequency,
        firstDate: stream.firstDate,
        accountId: stream.plaidAccountId,
      },
    });
  }

  return insights;
}
