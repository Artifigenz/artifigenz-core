import { getClaudeClient } from "../lib/claude-client";
import type { Category } from "../categorize/llm-classify";
import type { Digest } from "./digest";

export interface BriefNumber {
  value: string;
  phrase: string;
}

export interface BriefOutput {
  verdict: string;
  numbers: BriefNumber[];
  paragraph: string;
  dataScope: string;
}

const BRIEF_MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You are the user's personal finance agent, speaking directly to them in the first person. Your job is to produce the Brief — a single compressed read of their financial situation, shown as the home screen of the Finance agent.

Your tone: sharp, warm, plain-spoken advisor. Not a chatbot. Not a dashboard. You are a person who has looked at their accounts and is telling them what you see.

You always return JSON in the exact shape specified. No prose outside the JSON.`;

function formatMoney(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const formatted = abs.toLocaleString("en-US");
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function categorySummaryBlock(d: Digest): string {
  const order: Category[] = [
    "income",
    "subscription",
    "loan_emi",
    "fee_interest",
    "variable_recurring",
    "internal_transfer",
    "miscellaneous",
  ];
  const lines = order.map((c) => {
    const t = d.categoryTotals[c];
    const top =
      t.topMerchants.length > 0
        ? ` — top: ${t.topMerchants
            .map((m) => `${m.merchant} (${formatMoney(m.monthly)}/mo)`)
            .join(", ")}`
        : "";
    return `- ${c}: ${formatMoney(t.monthly)}/mo across ${t.txnCount} txns${top}`;
  });
  return lines.join("\n");
}

function recurringBlock(d: Digest): string {
  if (d.recurringStreams.length === 0) return "No recurring streams detected.";
  return d.recurringStreams
    .slice(0, 12)
    .map(
      (s) =>
        `- ${s.merchant} (${s.category}, ${s.cadence}): ${formatMoney(s.monthlyAmount)}/mo`,
    )
    .join("\n");
}

function buildUserPrompt(digest: Digest): string {
  const marginPct = digest.incomeMonthly > 0
    ? (digest.leftoverMonthly / digest.incomeMonthly) * 100
    : 0;
  const surplusOrDeficit = digest.leftoverMonthly >= 0 ? "surplus" : "deficit";
  const recurringMonthly =
    digest.categoryTotals.subscription.monthly +
    digest.categoryTotals.loan_emi.monthly +
    digest.categoryTotals.variable_recurring.monthly;
  const recurringPct = digest.incomeMonthly > 0
    ? (recurringMonthly / digest.incomeMonthly) * 100
    : 0;

  return `Produce the Brief for this user. Return JSON with exactly these fields:

{
  "verdict":    string,   // one sentence, first-person, plain English
  "numbers":    array,    // 2 or 3 entries, rules below
  "paragraph":  string,   // 2-3 sentences, must contain exactly one non-obvious insight
  "data_scope": string    // "Based on N accounts, D days."
}

## SITUATION

Monthly income:    ${formatMoney(digest.incomeMonthly)}
Monthly expenses:  ${formatMoney(digest.expensesMonthly)}
Monthly leftover:  ${formatMoney(digest.leftoverMonthly)} (${surplusOrDeficit})
Margin:            ${marginPct.toFixed(1)}% of income
Recurring load:    ${formatMoney(recurringMonthly)}/mo (${recurringPct.toFixed(1)}% of income)
Negative bal days: ${digest.riskFlags.negativeBalanceDays}
NSF/overdraft hits: ${digest.riskFlags.nsfCount}
Days of data:      ${digest.daysOfData}
Accounts:          ${digest.accountsCount}

## CATEGORY BREAKDOWN

${categorySummaryBlock(digest)}

## RECURRING STREAMS (top 12 by monthly amount)

${recurringBlock(digest)}

## RULES — verdict
- One sentence, first person ("You're...", "Your...").
- Match the data — not more positive or negative than reality.
- Be specific when it helps (mention an amount, %, or cause).
- Punchy, not clinical. No emojis.

## RULES — numbers
- Include exactly 3 entries if days_of_data >= 60 AND accounts_count >= 2.
- Otherwise, exactly 2 entries.
- Default triplet: income, leftover, recurring load.
- You may swap one entry for a more relevant number when it serves the verdict (e.g. an overdraft count, or a category leak like subscriptions).
- Each entry shape: { "value": "$X/mo or $X", "phrase": "2-6 word verdict phrase" }.

## RULES — paragraph
- 2-3 sentences, first person.
- Pick ONE non-obvious interpretation (a pattern, concentration, drift, or risk).
- Name specific merchants/amounts when it adds insight.
- Don't restate the numbers — interpret them.

## RULES — data_scope
- Exactly: "Based on N accounts, D days." where N = accounts_count, D = days_of_data.`;
}

function parseJsonFromResponse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1]);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }
  return JSON.parse(trimmed);
}

function validateBriefShape(b: unknown): asserts b is {
  verdict: string;
  numbers: BriefNumber[];
  paragraph: string;
  data_scope: string;
} {
  if (!b || typeof b !== "object") throw new Error("Brief must be an object");
  const o = b as Record<string, unknown>;
  if (typeof o.verdict !== "string" || !o.verdict)
    throw new Error("Brief.verdict must be a non-empty string");
  if (!Array.isArray(o.numbers) || o.numbers.length < 1 || o.numbers.length > 3)
    throw new Error("Brief.numbers must be 1-3 entries");
  for (const n of o.numbers) {
    if (!n || typeof n !== "object")
      throw new Error("Brief.numbers[] must be objects");
    const e = n as Record<string, unknown>;
    if (typeof e.value !== "string" || !e.value)
      throw new Error("Brief.numbers[].value must be non-empty string");
    if (typeof e.phrase !== "string" || !e.phrase)
      throw new Error("Brief.numbers[].phrase must be non-empty string");
  }
  if (typeof o.paragraph !== "string" || !o.paragraph)
    throw new Error("Brief.paragraph must be a non-empty string");
  if (typeof o.data_scope !== "string" || !o.data_scope)
    throw new Error("Brief.data_scope must be a non-empty string");
}

export async function generateBriefLLM(digest: Digest): Promise<BriefOutput> {
  const claude = getClaudeClient();

  const resp = await claude.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(digest) }],
  });

  const text = resp.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Empty response from Claude");

  const parsed = parseJsonFromResponse(text);
  validateBriefShape(parsed);

  return {
    verdict: parsed.verdict,
    numbers: parsed.numbers,
    paragraph: parsed.paragraph,
    dataScope: parsed.data_scope,
  };
}
