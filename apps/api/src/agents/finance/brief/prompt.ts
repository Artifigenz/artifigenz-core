import type { Digest } from "./helpers/types";
import {
  extractVerdictDimensions,
  type VerdictDimensions,
} from "./helpers/verdict-dimensions";

export const BRIEF_SYSTEM_PROMPT = `You are the user's personal finance agent, speaking directly to them in the first person. Your job is to produce the Brief — a single compressed read of their financial situation, shown as the home screen of the Finance agent.

Your tone: sharp, warm, plain-spoken advisor. Not a chatbot. Not a dashboard. You are a person who has looked at their accounts and is telling them what you see.

You always return JSON in the exact shape specified. No prose outside the JSON.`;

/**
 * Format a number as money (e.g., $1,234 or -$567).
 */
function formatMoney(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const formatted = abs.toLocaleString("en-US");
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Build the verdict prompt using structured dimensions.
 */
function buildVerdictSection(d: VerdictDimensions): string {
  const lines: string[] = [];

  lines.push("## VERDICT DIMENSIONS");
  lines.push("");
  lines.push("Generate a one-sentence verdict based on these dimensions:");
  lines.push("");

  // Cash Position
  lines.push("**CASH POSITION**");
  lines.push(`Monthly income: ${formatMoney(d.incomeMonthly)}`);
  lines.push(
    `Monthly leftover: ${formatMoney(d.leftoverMonthly)} (${d.surplusOrDeficit})`,
  );
  lines.push(`Margin: ${d.marginPercent.toFixed(1)}% of income`);
  lines.push("");

  // Fixed Load
  lines.push("**FIXED LOAD**");
  lines.push(`Recurring expenses: ${formatMoney(d.recurringMonthly)}/mo`);
  lines.push(`Recurring as % of income: ${d.recurringPercent.toFixed(1)}%`);
  lines.push("");

  // Stress Signals
  lines.push("**STRESS SIGNALS**");
  if (d.negativeBalanceDays > 0) {
    lines.push(`• Negative balance: ${d.negativeBalanceDays} days`);
  } else {
    lines.push("• No negative balance days");
  }
  if (d.nsfCount > 0) {
    lines.push(`• Overdraft/NSF fees: ${d.nsfCount} occurrences`);
  } else {
    lines.push("• No overdraft fees");
  }
  lines.push("");

  // Trend
  lines.push("**TREND**");
  lines.push(`Direction: ${d.trend}`);
  if (d.trendDetail) {
    lines.push(`Detail: ${d.trendDetail}`);
  }
  lines.push("");

  // Root Cause
  lines.push("**ROOT CAUSE**");
  if (d.biggestRecurring) {
    lines.push(
      `Biggest recurring: ${d.biggestRecurring.name} at ${formatMoney(d.biggestRecurring.amount)}/mo (${d.biggestRecurring.percentOfIncome.toFixed(1)}% of income)`,
    );
  }
  if (d.biggestDiscretionary) {
    lines.push(
      `Biggest discretionary: ${d.biggestDiscretionary.name} at ${formatMoney(d.biggestDiscretionary.amount)} this period`,
    );
  }
  lines.push("");

  // Buffer
  lines.push("**BUFFER**");
  lines.push(`Current balance: ${formatMoney(d.currentBalance)}`);
  lines.push(
    `Runway: ~${d.runwayDays > 100 ? "100+" : d.runwayDays} days at current spend rate`,
  );
  lines.push("");

  // Verdict Rules
  lines.push("**VERDICT RULES**");
  lines.push("- One sentence, first person (\"You're...\", \"Your...\")");
  lines.push("- Match the data — not more positive or negative than reality");
  lines.push("- Be specific when it helps (mention amounts, percentages, or causes)");
  lines.push("- Punchy, not clinical or generic");
  lines.push("- No emojis");
  lines.push("");

  return lines.join("\n");
}

export function buildBriefPrompt(digest: Digest): string {
  const dimensions = extractVerdictDimensions(digest);

  return `Produce the Brief for this user. Return a JSON object with exactly these fields:

{
  "verdict":    string,   // one sentence, first-person, plain English
  "numbers":    array,    // 2 or 3 entries, rules below
  "paragraph":  string,   // 2-3 sentences, must contain exactly one non-obvious insight
  "data_scope": string    // "Based on N accounts, D days."
}

${buildVerdictSection(dimensions)}

RULES — numbers
- Include exactly 3 entries if digest.days_of_data >= 60 AND digest.accounts_count >= 2.
- Include exactly 2 entries otherwise.
- Default triplet: income, leftover, recurring.
- You may swap one of these for a different number if it better supports the verdict — for example, a buffer-floor number ("$490 buffer by the 25th") when the verdict is about timing, or a fee number when the verdict is about leakage. Only swap when the swap clearly serves the verdict.
- Each entry MUST be shaped: { "value": "<$X/mo label>", "phrase": "<2-6 word verdict phrase>" }.
- Never a raw number without a phrase.

Phrase examples: "consistent", "thin for your income", "37% of income", "top 20% for your area", "above average", "healthy", "running lean".

RULES — paragraph
- 2 or 3 sentences. First person (I, you). Plain English.
- Must contain exactly ONE non-obvious interpretive insight, derived from the digest below. Not a summary of the numbers. Not a restatement of the verdict.
- Sources to mine for the insight:
  * balance_series — timing patterns (e.g. payday-to-month-end buffer drop percentage)
  * top_merchants — concentration (e.g. "80% of non-recurring spend goes to 3 places")
  * new_recurring_count — drift (e.g. "you've picked up N subscriptions in the last 60 days")
  * risk_flags — warnings (negative-balance days, NSF fees)
  * inflow_streams / outflow_streams — income consistency, recurring composition
- Pick the strongest single insight. Resist the urge to pack in more than one.

RULES — data_scope
- Exactly: "Based on N accounts, D days." where N and D come from digest.accounts_count and digest.days_of_data.

DIGEST:
${JSON.stringify(digest, null, 2)}`;
}
