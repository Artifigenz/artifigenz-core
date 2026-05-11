import { getClaudeClient } from "../lib/claude-client";
import type { AccountContext, MerchantCluster } from "./build-clusters";

export const CATEGORIES = [
  "income",
  "subscription",
  "loan_emi",
  "fee_interest",
  "variable_recurring",
  "internal_transfer",
  "miscellaneous",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CADENCES = [
  "monthly",
  "weekly",
  "biweekly",
  "quarterly",
  "annual",
  "irregular",
  "one_time",
] as const;
export type Cadence = (typeof CADENCES)[number];

export interface ClassificationResult {
  category: Category;
  isRecurring: boolean;
  cadence: Cadence;
  monthlyAmount: number;
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You categorize merchants based on a user's transaction history.

SIGN CONVENTION — READ CAREFULLY:
- Positive amount = money LEFT the account (spending, payments, fees, charges)
- Negative amount = money ENTERED the account (deposits, income, refunds, transfers in)

This sign convention is the most important signal:
- If ALL transactions for a merchant are NEGATIVE, this is an INFLOW pattern.
  Inflows can ONLY be: income OR internal_transfer. NEVER subscription, loan_emi,
  fee_interest, variable_recurring, or miscellaneous — those are by definition
  money going OUT of the account.
- If ALL transactions are POSITIVE, this is an OUTFLOW. It can be subscription,
  loan_emi, fee_interest, variable_recurring, or miscellaneous. NEVER income.
- Mixed signs usually means internal_transfer (the user moves money in both
  directions) or fee_interest (banks credit then re-debit).

Do not let the merchant NAME override the sign. A company named "Microsoft" can
be the user's EMPLOYER if all the deposits are negative and regular — in that
case it is INCOME, not a subscription.

Categories (pick exactly one):
- income: RECURRING deposits from an employer, business, or government source —
    paychecks, salary, payroll, freelance retainer, pension, rental income,
    government benefits. Strong signals: at least 2 deposits in a regular cadence
    (biweekly, monthly), OR clear payer wording ("PAYROLL", "PAY", "DEPOSIT FROM
    <COMPANY>", "GOV CANADA"). A SINGLE deposit from an individual person is NOT
    income — it's an internal_transfer.
- subscription: fixed recurring digital service charges going OUT (Netflix, gym,
    software, magazines). All amounts must be positive.
- loan_emi: recurring loan or installment payments going OUT (mortgage, car
    payment, Affirm, student loan). All amounts must be positive.
- fee_interest: bank fees, interest charges, NSF, overdraft, ATM fees, FX fees.
- variable_recurring: recurring bills with varying amounts going OUT (utilities,
    phone, internet, insurance). All amounts must be positive.
- internal_transfer: any movement that isn't income/spending —
    - between the user's OWN accounts
    - e-transfers / Interac transfers to or from themselves (same name as user)
    - one-off money received from another individual (NOT an employer)
    - credit card payments, line-of-credit payments
    - investment account contributions / withdrawals
- miscellaneous: one-off SPENDING — groceries, restaurants, retail, travel,
    anything not above. All amounts must be positive.

When in doubt between income vs internal_transfer for an inflow, prefer
internal_transfer unless there's a clear employer/business pattern.

Cadence options: monthly, weekly, biweekly, quarterly, annual, irregular, one_time

monthly_amount estimation:
- For recurring: normalize to monthly cost (e.g. a $120 annual fee → 10, a $50 weekly charge → 217)
- For one_time / miscellaneous: the average per-charge amount divided by months observed (or 0 if you can't estimate)
- Always positive in your response, regardless of sign convention above

Return ONLY valid JSON matching this schema, no markdown, no explanation:
{
  "category": "<one of the 7>",
  "is_recurring": <boolean>,
  "cadence": "<one of the 7 cadences>",
  "monthly_amount": <number, always positive>,
  "confidence": <number 0.0-1.0>,
  "reasoning": "<1-2 sentence explanation>"
}`;

function buildAccountsBlock(
  accounts: AccountContext[],
  userName?: string | null,
): string {
  const nameLine = userName
    ? `The user's name is: ${userName} (transfers to/from this name = self-transfer).`
    : "";
  if (accounts.length === 0) {
    return [nameLine, "The user has no other accounts on record."]
      .filter(Boolean)
      .join("\n");
  }
  const lines = accounts.map((a) => {
    const inst = a.institutionName ?? "Unknown bank";
    const last4 = a.accountLast4 ? `…${a.accountLast4}` : "(no number)";
    const type = a.type ?? "unknown type";
    return `- ${inst} ${last4} (${type})`;
  });
  return [nameLine, `The user owns these accounts:\n${lines.join("\n")}`]
    .filter(Boolean)
    .join("\n");
}

function buildTxnsBlock(cluster: MerchantCluster, accountMap: Map<string, AccountContext>): string {
  const lines = cluster.txns
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const acct = t.accountId ? accountMap.get(t.accountId) : null;
      const acctTag = acct
        ? `${acct.institutionName ?? "?"}…${acct.accountLast4 ?? ""}`
        : "?";
      const sign = t.amount >= 0 ? "+" : "";
      return `  ${t.date} | ${sign}${t.amount.toFixed(2)} | ${acctTag} | ${t.description}`;
    });
  return lines.join("\n");
}

function extractJson(text: string): string {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

function clampNumber(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function isCategory(s: unknown): s is Category {
  return typeof s === "string" && (CATEGORIES as readonly string[]).includes(s);
}

function isCadence(s: unknown): s is Cadence {
  return typeof s === "string" && (CADENCES as readonly string[]).includes(s);
}

/**
 * Classify a single merchant cluster with one LLM call. The model sees the
 * full transaction list for this merchant plus the user's account context
 * (for internal-transfer detection).
 */
export async function classifyCluster(
  cluster: MerchantCluster,
  accounts: AccountContext[],
  userName?: string | null,
): Promise<ClassificationResult> {
  const claude = getClaudeClient();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const userMessage = [
    buildAccountsBlock(accounts, userName),
    "",
    `Merchant: ${cluster.displayName}`,
    `Normalized key: ${cluster.merchantNormalized}`,
    `Transactions (${cluster.txnCount} total, first ${cluster.firstSeenDate}, last ${cluster.lastSeenDate}):`,
    buildTxnsBlock(cluster, accountMap),
  ].join("\n");

  const resp = await claude.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = resp.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Classifier returned no text for ${cluster.merchantNormalized}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJson(textBlock.text));
  } catch (err) {
    throw new Error(
      `Classifier returned invalid JSON for ${cluster.merchantNormalized}: ${err}\n` +
        `Raw: ${textBlock.text.slice(0, 300)}`,
    );
  }

  let category: Category = isCategory(parsed.category)
    ? parsed.category
    : "miscellaneous";
  let cadence: Cadence = isCadence(parsed.cadence) ? parsed.cadence : "irregular";
  let isRecurring = parsed.is_recurring === true;
  let reasoning =
    typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 400) : "";

  // Sign-sanity post-check. The LLM occasionally pattern-matches on a merchant
  // name and misses that all amounts are negative (an inflow) — e.g. classifies
  // a "Microsoft" payroll deposit as a subscription. Force inflows into
  // {income, internal_transfer} and outflows out of {income}.
  const allNegative = cluster.txns.every((t) => t.amount < 0);
  const allPositive = cluster.txns.every((t) => t.amount > 0);
  const EXPENSE_CATEGORIES: Category[] = [
    "subscription",
    "loan_emi",
    "fee_interest",
    "variable_recurring",
    "miscellaneous",
  ];

  if (allNegative && EXPENSE_CATEGORIES.includes(category)) {
    // Inflows can't be expenses. Promote to income if the LLM thought it was
    // recurring, otherwise treat as a transfer.
    const recurringCadence = ["weekly", "biweekly", "monthly", "quarterly", "annual"];
    if (isRecurring && recurringCadence.includes(cadence)) {
      category = "income";
      reasoning = `[sign-corrected: all amounts negative, recurring] ${reasoning}`;
    } else {
      category = "internal_transfer";
      isRecurring = false;
      reasoning = `[sign-corrected: all amounts negative, one-off] ${reasoning}`;
    }
  } else if (allPositive && category === "income") {
    // Outflows can't be income. Most likely miscellaneous spending.
    category = "miscellaneous";
    reasoning = `[sign-corrected: all amounts positive, can't be income] ${reasoning}`;
  }

  return {
    category,
    isRecurring,
    cadence,
    monthlyAmount: Math.abs(clampNumber(parsed.monthly_amount, 0, 1_000_000, 0)),
    confidence: clampNumber(parsed.confidence, 0, 1, 0.5),
    reasoning,
  };
}
