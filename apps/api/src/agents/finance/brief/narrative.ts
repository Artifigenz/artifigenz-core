import { getClaudeClient } from "../lib/claude-client";
import type { BriefNumbers, BriefSignals, Signal } from "./compute";

/**
 * Headline generator. Takes the deterministic numbers + ranked signals
 * and asks Claude for one opinionated sentence that reads like a verdict.
 *
 * We tell the LLM exactly which signals to lean on (the top 1-2) so the
 * voice stays consistent across months — without this it tends to drift
 * into vague "you're doing okay" filler.
 */

const NARRATIVE_MODEL = "claude-sonnet-4-6";

export interface Narrative {
  headline: string;
  signalsUsed: string[];
  confidence: number;
}

export async function generateHeadline(
  numbers: BriefNumbers,
  signals: BriefSignals,
): Promise<Narrative> {
  // Pick the top 1-2 signals worth highlighting. `surplus` / `deficit`
  // / `break_even` is always #1 (it's the verdict frame). The second
  // signal is whatever follows in the ranked list.
  const top = signals.ranked.slice(0, 2);
  const signalsUsed = top.map((s) => s.type);

  const client = getClaudeClient();
  const response = await client.messages.create({
    model: NARRATIVE_MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildUserPrompt(numbers, top),
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();

  let headline = text;
  // Strip any accidental wrapping quotes the model produces.
  if (
    (headline.startsWith('"') && headline.endsWith('"')) ||
    (headline.startsWith("'") && headline.endsWith("'"))
  ) {
    headline = headline.slice(1, -1).trim();
  }

  return {
    headline,
    signalsUsed,
    confidence: 0.9,
  };
}

const SYSTEM_PROMPT = `You write one-sentence headlines that summarize a user's finances for a given period. The tone is opinionated but warm — like a friend who happens to be a CFO reading the user's data and giving a verdict at a glance.

You will receive:
- Period label (e.g., "May 2026" or "Average per month")
- The headline numbers: income, total outflow, leftover
- 1-2 ranked signals — short structured facts the data revealed

Rules:
- Write EXACTLY one sentence. No greeting, no markdown, no quotes.
- Lead with the financial verdict implied by the first signal (surplus / deficit / break-even / no-income). Frame the leftover number as the key proof.
- If a second signal is supplied, weave it into the same sentence — usually after an em-dash or a "with" clause. Don't tack on a separate thought.
- Use concrete numbers from the structured input — never invent figures. Round dollar amounts to the nearest hundred when stating them ("$2,400 ahead", "$120 over"), never include cents.
- Refer to brands by their display name if a signal contains brands.
- Keep it short and punchy — under 25 words ideally, hard cap at 35.
- Don't repeat the period label ("This month…") inside the headline; the UI shows the month right next to it.
- No hedging language ("seems", "appears"). Make a call.

Output: ONLY the headline sentence, nothing else. No markdown, no quotes, no preface.`;

function buildUserPrompt(numbers: BriefNumbers, top: Signal[]): string {
  const signalLines = top.map(formatSignalForPrompt).join("\n");
  return `Period: ${numbers.label}
Income: $${numbers.income.toFixed(0)}
Outflow: $${numbers.outflow.toFixed(0)}
Leftover: $${numbers.leftover.toFixed(0)}

Ranked signals (highlight #1, weave in #2 if listed):
${signalLines}

Write the one-sentence verdict.`;
}

function formatSignalForPrompt(s: Signal): string {
  switch (s.type) {
    case "surplus":
      return `- surplus: $${Math.round(s.amount)} ahead (${s.percent}% of income)`;
    case "deficit":
      return `- deficit: $${Math.round(s.amount)} short (${s.percent}% over income)`;
    case "break_even":
      return `- break_even: income and outflow roughly even`;
    case "no_income":
      return `- no_income: no income detected this period`;
    case "mom_spend_change": {
      const direction = s.deltaPercent > 0 ? "up" : "down";
      return `- mom_spend_change: spend ${direction} ${Math.abs(s.deltaPercent)}% vs prior month`;
    }
    case "new_subscription":
      return `- new_subscription: new this period — ${s.brands.join(", ")}`;
    case "potentially_cancelled_subscription":
      return `- potentially_cancelled_subscription: didn't post this period — ${s.brands.join(", ")}`;
    case "category_mover": {
      const direction = s.deltaPercent > 0 ? "up" : "down";
      return `- category_mover: ${s.category} ${direction} ${Math.abs(s.deltaPercent)}% ($${Math.round(s.from)} → $${Math.round(s.to)})`;
    }
    case "missing_expected_charge":
      return `- missing_expected_charge: ${s.brand} usually charges but didn't this period (last seen ${s.lastSeen})`;
    case "first_full_month":
      return `- first_full_month: this is the first complete month on file, no MoM comparison`;
  }
}
