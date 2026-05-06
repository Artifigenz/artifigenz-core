import type { Digest } from "./helpers/types";
import {
  extractVerdictDimensions,
  type VerdictDimensions,
} from "./helpers/verdict-dimensions";
import {
  extractNarrativeDimensions,
  type NarrativeDimensions,
} from "./helpers/narrative-dimensions";

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

/**
 * Build the narrative prompt using structured dimensions.
 */
function buildNarrativeSection(d: NarrativeDimensions): string {
  const lines: string[] = [];

  lines.push("## NARRATIVE DIMENSIONS");
  lines.push("");
  lines.push("Pick the most significant dimension. Write 2-3 sentences exploring it.");
  lines.push("Do not summarize numbers. Provide ONE non-obvious interpretive insight.");
  lines.push("");

  // Timing
  lines.push("**TIMING** (cash flow patterns within the month)");
  if (d.timing.paydayToMonthEndDropPercent !== null) {
    lines.push(
      `Payday-to-month-end balance drop: ${d.timing.paydayToMonthEndDropPercent.toFixed(0)}%`,
    );
  }
  if (d.timing.lowestBalanceDay !== null && d.timing.lowestBalanceAmount !== null) {
    lines.push(
      `Lowest point: ${d.timing.lowestBalanceDay}th of month (${formatMoney(d.timing.lowestBalanceAmount)})`,
    );
  }
  if (d.timing.pattern) {
    lines.push(`Pattern: ${d.timing.pattern}`);
  }
  if (
    d.timing.paydayToMonthEndDropPercent === null &&
    d.timing.lowestBalanceDay === null
  ) {
    lines.push("Not enough data for timing analysis");
  }
  lines.push("");

  // Concentration
  lines.push("**CONCENTRATION** (spending concentration in merchants)");
  if (d.concentration.top3Percent > 0) {
    lines.push(
      `Top 3 merchants: ${d.concentration.top3Percent.toFixed(0)}% of discretionary spend`,
    );
  }
  if (d.concentration.biggestMerchant) {
    lines.push(
      `Biggest: ${d.concentration.biggestMerchant.name} at ${formatMoney(d.concentration.biggestMerchant.amount)} (${d.concentration.biggestMerchant.count} transactions)`,
    );
  }
  if (d.concentration.merchantCount > 0) {
    lines.push(`Total merchants: ${d.concentration.merchantCount}`);
  }
  lines.push("");

  // Drift
  lines.push("**DRIFT** (recent subscription/recurring additions)");
  if (d.drift.newSubscriptionCount > 0) {
    lines.push(`New subscriptions (last 60 days): ${d.drift.newSubscriptionCount}`);
    lines.push(`New recurring added: ${formatMoney(d.drift.newRecurringMonthly)}/mo`);
    if (d.drift.recentAdditions.length > 0) {
      lines.push(`Recent additions: ${d.drift.recentAdditions.join(", ")}`);
    }
  } else {
    lines.push("No new subscriptions detected in last 60 days");
  }
  lines.push("");

  // Risk
  lines.push("**RISK** (warning signals)");
  if (d.risk.severity === "none") {
    lines.push("No significant risk signals");
  } else {
    lines.push(`Severity: ${d.risk.severity}`);
    if (d.risk.negativeBalanceDays > 0) {
      lines.push(`Negative balance days: ${d.risk.negativeBalanceDays}`);
    }
    if (d.risk.nsfCount > 0) {
      lines.push(`NSF/overdraft fees: ${d.risk.nsfCount} occurrences`);
    }
    if (d.risk.interestChargesMonthly !== null) {
      lines.push(
        `Interest charges: ~${formatMoney(d.risk.interestChargesMonthly)}/mo`,
      );
    }
  }
  lines.push("");

  // Composition
  lines.push("**COMPOSITION** (income and recurring structure)");
  lines.push(`Income sources: ${d.composition.incomeSourceCount}`);
  if (d.composition.incomePrimarySource) {
    lines.push(
      `Primary source: ${d.composition.incomePrimarySource} (${d.composition.incomeConcentrationPercent.toFixed(0)}% of income)`,
    );
  }
  lines.push(`Recurring expense streams: ${d.composition.recurringStreamCount}`);
  if (d.composition.biggestRecurring) {
    lines.push(
      `Biggest recurring: ${d.composition.biggestRecurring.name} at ${formatMoney(d.composition.biggestRecurring.amount)}/mo (${d.composition.biggestRecurring.percentOfIncome.toFixed(0)}% of income)`,
    );
  }
  lines.push("");

  // Narrative Rules
  lines.push("**NARRATIVE RULES**");
  lines.push("- 2-3 sentences, first person (I, you)");
  lines.push("- Pick ONE dimension — the most significant for this user");
  lines.push("- Interpret, don't summarize the numbers");
  lines.push("- Name specific merchants, amounts, or patterns when it adds insight");
  lines.push("- No emojis");
  lines.push("");

  return lines.join("\n");
}

export function buildBriefPrompt(digest: Digest): string {
  const verdictDimensions = extractVerdictDimensions(digest);
  const narrativeDimensions = extractNarrativeDimensions(digest);

  return `Produce the Brief for this user. Return a JSON object with exactly these fields:

{
  "verdict":    string,   // one sentence, first-person, plain English
  "numbers":    array,    // 2 or 3 entries, rules below
  "paragraph":  string,   // 2-3 sentences, must contain exactly one non-obvious insight
  "data_scope": string    // "Based on N accounts, D days."
}

${buildVerdictSection(verdictDimensions)}

RULES — numbers
- Include exactly 3 entries if digest.days_of_data >= 60 AND digest.accounts_count >= 2.
- Include exactly 2 entries otherwise.
- Default triplet: income, leftover, recurring.
- You may swap one of these for a different number if it better supports the verdict — for example, a buffer-floor number ("$490 buffer by the 25th") when the verdict is about timing, or a fee number when the verdict is about leakage. Only swap when the swap clearly serves the verdict.
- Each entry MUST be shaped: { "value": "<$X/mo label>", "phrase": "<2-6 word verdict phrase>" }.
- Never a raw number without a phrase.

Phrase examples: "consistent", "thin for your income", "37% of income", "top 20% for your area", "above average", "healthy", "running lean".

${buildNarrativeSection(narrativeDimensions)}

RULES — data_scope
- Exactly: "Based on N accounts, D days." where N and D come from digest.accounts_count and digest.days_of_data.

DIGEST:
${JSON.stringify(digest, null, 2)}`;
}
