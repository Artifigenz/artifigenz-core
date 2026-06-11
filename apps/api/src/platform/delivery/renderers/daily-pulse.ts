import type { FormattedMessage, InsightForDelivery, InlineKeyboardButton } from "../types";

/**
 * Telegram-specific rich renderer for Daily Pulse insights. Falls back
 * to the channel's generic formatter when the insight isn't a daily
 * pulse, so the caller stays simple.
 *
 * Layout:
 *
 *   <b>Daily Pulse · Wed Jun 10</b>
 *   💰  Cash CA$3,691
 *   💳  Owed CA$9,795
 *
 *   📊 Yesterday — 11 charges · CA$711
 *      • Non-TD ATM Withdrawal CA$300
 *      • D Lounge CA$120
 *      • Transfer CA$60
 *
 *   ⏰ Today — 1 expected · CA$10
 *      • Willow TV CA$10
 *
 *   ⚠️ Reconnect needed: RBC Royal Bank
 *
 *   [View on web]  [Reconnect RBC]
 */

interface PulseData {
  date?: string;
  balance?: {
    cashTotal?: number;
    owedTotal?: number;
    currency?: string;
    cashAccounts?: Array<{ name?: string; last4?: string | null; balance?: number }>;
    owedAccounts?: Array<{ name?: string; last4?: string | null; balance?: number }>;
  };
  recap?: {
    date?: string;
    isStale?: boolean;
    count?: number;
    total?: number;
    topBrands?: Array<{ displayName?: string | null; total?: number }>;
  };
  today?: {
    expected?: Array<{ displayName?: string; amount?: number; expectedDate?: string }>;
    expectedTotal?: number;
  };
  sync?: { brokenConnections?: string[] };
}

export function tryRenderDailyPulseTelegram(
  insight: InsightForDelivery,
  webAppBaseUrl: string | null,
): FormattedMessage | null {
  if (insight.insightTypeId !== "finance.daily-pulse.morning") return null;
  const data = (insight.data ?? {}) as PulseData;
  const ccy = data.balance?.currency ?? "USD";
  const money = (n: number | undefined | null) =>
    n == null ? "" : formatMoney(n, ccy);

  const lines: string[] = [];
  lines.push(`<b>${escapeHtml(insight.title)}</b>`);

  // Balance block
  const balanceLines: string[] = [];
  if (data.balance?.cashTotal !== undefined && data.balance.cashTotal > 0) {
    balanceLines.push(`💰  Cash <b>${money(data.balance.cashTotal)}</b>`);
  }
  if (data.balance?.owedTotal !== undefined && data.balance.owedTotal > 0) {
    balanceLines.push(`💳  Owed <b>${money(data.balance.owedTotal)}</b>`);
  }
  if (balanceLines.length > 0) {
    lines.push("");
    lines.push(...balanceLines);
  }

  // Yesterday recap
  if (data.recap) {
    const label = data.recap.isStale && data.recap.date
      ? `📊  <b>Last activity ${formatShortDate(data.recap.date)}</b>`
      : `📊  <b>Yesterday</b>`;
    lines.push("");
    if ((data.recap.count ?? 0) > 0) {
      lines.push(
        `${label} — ${data.recap.count} charge${data.recap.count === 1 ? "" : "s"} · ${money(
          data.recap.total,
        )}`,
      );
      for (const b of (data.recap.topBrands ?? []).slice(0, 4)) {
        if (b.displayName) {
          lines.push(`   • ${escapeHtml(b.displayName)} <i>${money(b.total)}</i>`);
        }
      }
    } else {
      lines.push(`${label} — quiet, no activity`);
    }
  }

  // Today expected
  if (data.today) {
    const exp = data.today.expected ?? [];
    lines.push("");
    if (exp.length > 0) {
      lines.push(
        `⏰  <b>Today</b> — ${exp.length} expected · ${money(data.today.expectedTotal)}`,
      );
      for (const e of exp.slice(0, 5)) {
        lines.push(
          `   • ${escapeHtml(e.displayName ?? "")} <i>${money(e.amount)}</i>`,
        );
      }
    } else {
      lines.push(`⏰  <b>Today</b> — nothing predictable on the calendar`);
    }
  }

  // Broken connection callout
  const broken = data.sync?.brokenConnections ?? [];
  if (broken.length > 0) {
    lines.push("");
    lines.push(`⚠️  Reconnect needed: <b>${broken.map(escapeHtml).join(", ")}</b>`);
  }

  const body = lines.join("\n");

  // Inline keyboard
  const keyboard: InlineKeyboardButton[][] = [];
  const row: InlineKeyboardButton[] = [];
  if (webAppBaseUrl) {
    row.push({ text: "📱 View on web", url: `${webAppBaseUrl}/finance` });
  }
  if (broken.length > 0 && webAppBaseUrl) {
    row.push({
      text: "🔁 Reconnect",
      url: `${webAppBaseUrl}/finance/accounts`,
    });
  }
  if (row.length > 0) keyboard.push(row);

  return {
    body,
    inlineKeyboard: keyboard.length > 0 ? keyboard : undefined,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }
}

function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
