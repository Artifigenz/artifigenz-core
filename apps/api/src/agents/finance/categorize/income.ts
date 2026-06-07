import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  financeAccounts,
  financeTransactions,
  userBrandCategories,
} from "@artifigenz/db";
import { getClaudeClient } from "../lib/claude-client";

/**
 * Income detection (Stage 2.3, second slice).
 *
 * Targets three subtypes only — anything else stays uncategorized so a
 * future pass can revisit:
 *   • salary             — regular employer pay (recurring stream OR
 *                          clearly-named employer)
 *   • investment_income  — dividends, interest paid, coupons
 *   • gov_benefit        — tax refunds, government transfers
 *
 * Architecture mirrors detectInternalTransfers: per-brand processing,
 * cache results in user_brand_categories, only touch txns where
 * category IS NULL. Pre-condition: detectInternalTransfers ran first
 * so legitimate internal transfers don't get mistaken for income.
 *
 * Per the user's direction: LLM confirms every brand at every stage.
 * No purely-deterministic auto-classification — the deterministic
 * stats (cadence regularity, amount stability) are *passed to the LLM*
 * as context, not used as an independent decision. This protects
 * against pattern-only false positives (e.g., a monthly $500 friend
 * payback that looks salary-shaped to a regex but obviously isn't
 * salary to a model that sees the sender is a person).
 *
 * Cost is not optimized here — per the user, prioritize correctness.
 */

const LLM_CONCURRENCY = 4;
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

export interface IncomeStats {
  candidatesFound: number;
  classifiedAsIncome: number;
  classifiedAsNotIncome: number;
  cacheHits: number;
  llmErrors: Array<{ brandSlug: string; error: string }>;
  bySubtype: Record<string, number>;
}

export async function detectIncome(
  agentInstanceId: string,
): Promise<IncomeStats> {
  const stats: IncomeStats = {
    candidatesFound: 0,
    classifiedAsIncome: 0,
    classifiedAsNotIncome: 0,
    cacheHits: 0,
    llmErrors: [],
    bySubtype: {},
  };

  // Gather inflow brand profiles (only brands the user has uncategorized
  // INflow transactions for). Single SQL pass — computes amount stats
  // and date stats inside the DB so we don't have to scan the rows on
  // the app side.
  const profiles = await db.execute<{
    brand_slug: string;
    display_name: string;
    txn_count: number;
    total_amount: string;
    avg_amount: string;
    amount_stddev: string;
    amount_min: string;
    amount_max: string;
    first_date: string;
    last_date: string;
    distinct_dates: number;
    span_days: number;
  }>(sql`
    SELECT
      mb.brand_slug,
      mb.display_name,
      COUNT(*)::int AS txn_count,
      ABS(SUM(ft.amount::numeric))::text AS total_amount,
      ABS(AVG(ft.amount::numeric))::text AS avg_amount,
      COALESCE(STDDEV_SAMP(ABS(ft.amount::numeric)), 0)::text AS amount_stddev,
      ABS(MAX(ft.amount::numeric))::text AS amount_min,
      ABS(MIN(ft.amount::numeric))::text AS amount_max,
      MIN(ft.transaction_date)::text AS first_date,
      MAX(ft.transaction_date)::text AS last_date,
      COUNT(DISTINCT ft.transaction_date)::int AS distinct_dates,
      GREATEST(MAX(ft.transaction_date) - MIN(ft.transaction_date), 1)::int AS span_days
    FROM finance_transactions ft
    INNER JOIN merchant_brands mb
      ON ft.merchant_normalized = mb.merchant_normalized
    WHERE ft.agent_instance_id = ${agentInstanceId}
      AND ft.category IS NULL
      AND ft.direction = 'in'  -- inflows only (Plaid convention: negative amount = in)
      AND mb.brand_slug IS NOT NULL
    GROUP BY mb.brand_slug, mb.display_name
    ORDER BY txn_count DESC
  `);

  stats.candidatesFound = profiles.length;
  if (profiles.length === 0) return stats;

  // Load user accounts for LLM context.
  const accounts = await db
    .select({
      institution: financeAccounts.institutionName,
      last4: financeAccounts.accountLast4,
      type: financeAccounts.type,
    })
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, agentInstanceId));
  const accountContext = accounts
    .map((a) => `${a.institution ?? "Unknown"} ${a.type ?? ""} ••${a.last4 ?? "?"}`.trim())
    .join(", ");

  // Check cache for all candidates in one go.
  const brandSlugs = profiles.map((p) => p.brand_slug);
  const cached = await db
    .select({
      brandSlug: userBrandCategories.brandSlug,
      category: userBrandCategories.category,
      systemCategory: userBrandCategories.systemCategory,
      confidence: userBrandCategories.confidence,
      reasoning: userBrandCategories.reasoning,
    })
    .from(userBrandCategories)
    .where(
      and(
        eq(userBrandCategories.agentInstanceId, agentInstanceId),
        inArray(userBrandCategories.brandSlug, brandSlugs),
      ),
    );
  const cacheMap = new Map(cached.map((c) => [c.brandSlug, c]));

  // Apply cache hits. A cache hit only counts if the cached category is
  // DEFINITIVE for income's purposes — i.e., "income" (apply it) or a
  // hard competing category like "internal_transfer" (skip it; another
  // detector owns this brand). A cached "other" from a previous detector
  // means only "not internal_transfer" — income still needs to evaluate.
  const DEFINITIVE_NON_INCOME = new Set([
    "internal_transfer",
    "subscription",
    "loan_emi",
    "fee_interest",
    "variable_recurring",
    "miscellaneous",
  ]);
  for (const p of profiles) {
    const hit = cacheMap.get(p.brand_slug);
    if (!hit) continue;
    if (hit.category === "income") {
      stats.cacheHits++;
      const applied = await applyIncomeToBrand(
        agentInstanceId,
        p.brand_slug,
        hit.systemCategory,
        hit.confidence,
        hit.reasoning,
      );
      if (applied > 0) {
        stats.bySubtype[hit.systemCategory ?? "unknown"] =
          (stats.bySubtype[hit.systemCategory ?? "unknown"] ?? 0) + applied;
      }
    } else if (DEFINITIVE_NON_INCOME.has(hit.category)) {
      // Another detector already claimed this brand — don't re-classify.
      stats.cacheHits++;
    }
    // hit.category === "other" → fall through to LLM (another detector
    // said "not me", but income hasn't evaluated yet).
  }

  // What's still uncached OR cached only as "other" (income hasn't seen).
  const uncached = profiles.filter((p) => {
    const hit = cacheMap.get(p.brand_slug);
    if (!hit) return true;
    if (hit.category === "income") return false;
    if (DEFINITIVE_NON_INCOME.has(hit.category)) return false;
    return true; // "other" or unknown — give income a turn
  });
  if (uncached.length === 0) return stats;

  // Bounded-parallel LLM classification.
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(LLM_CONCURRENCY, uncached.length) },
    async () => {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= uncached.length) return;
        const p = uncached[myIdx];
        try {
          const profile = buildProfile(p);
          const result = await classifyWithClaude(profile, accountContext);

          await db
            .insert(userBrandCategories)
            .values({
              agentInstanceId,
              brandSlug: p.brand_slug,
              category: result.isIncome ? "income" : "other",
              systemCategory: result.isIncome ? result.subtype : null,
              confidence: result.confidence.toFixed(2),
              source: "llm",
              reasoning: result.reasoning,
            })
            .onConflictDoUpdate({
              target: [
                userBrandCategories.agentInstanceId,
                userBrandCategories.brandSlug,
              ],
              set: {
                category: result.isIncome ? "income" : "other",
                systemCategory: result.isIncome ? result.subtype : null,
                confidence: result.confidence.toFixed(2),
                source: "llm",
                reasoning: result.reasoning,
                updatedAt: new Date(),
              },
            });

          if (result.isIncome) {
            const applied = await applyIncomeToBrand(
              agentInstanceId,
              p.brand_slug,
              result.subtype,
              result.confidence.toFixed(2),
              result.reasoning,
            );
            if (applied > 0) {
              stats.classifiedAsIncome++;
              stats.bySubtype[result.subtype] =
                (stats.bySubtype[result.subtype] ?? 0) + applied;
            }
          } else {
            stats.classifiedAsNotIncome++;
          }
        } catch (err) {
          stats.llmErrors.push({
            brandSlug: p.brand_slug,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  );
  await Promise.all(workers);

  return stats;
}

// ─── LLM call ────────────────────────────────────────────────────

interface BrandInflowProfile {
  brandSlug: string;
  displayName: string;
  txnCount: number;
  totalAmount: number;
  avgAmount: number;
  amountStdDevPct: number;
  amountMin: number;
  amountMax: number;
  firstDate: string;
  lastDate: string;
  avgDayGap: number;
  cadenceHint: string;
}

function buildProfile(row: {
  brand_slug: string;
  display_name: string;
  txn_count: number;
  total_amount: string;
  avg_amount: string;
  amount_stddev: string;
  amount_min: string;
  amount_max: string;
  first_date: string;
  last_date: string;
  distinct_dates: number;
  span_days: number;
}): BrandInflowProfile {
  const txnCount = row.txn_count;
  const avg = parseFloat(row.avg_amount);
  const stddev = parseFloat(row.amount_stddev);
  const avgDayGap =
    row.distinct_dates > 1 ? row.span_days / (row.distinct_dates - 1) : 0;
  return {
    brandSlug: row.brand_slug,
    displayName: row.display_name,
    txnCount,
    totalAmount: parseFloat(row.total_amount),
    avgAmount: avg,
    amountStdDevPct: avg > 0 ? Math.round((stddev / avg) * 100) : 0,
    amountMin: parseFloat(row.amount_min),
    amountMax: parseFloat(row.amount_max),
    firstDate: row.first_date,
    lastDate: row.last_date,
    avgDayGap: Math.round(avgDayGap),
    cadenceHint: classifyCadence(avgDayGap, txnCount),
  };
}

function classifyCadence(avgDayGap: number, txnCount: number): string {
  if (txnCount <= 1) return "one-off";
  if (avgDayGap >= 6 && avgDayGap <= 8) return "weekly";
  if (avgDayGap >= 12 && avgDayGap <= 16) return "biweekly";
  if (avgDayGap >= 14 && avgDayGap <= 17) return "semi-monthly";
  if (avgDayGap >= 27 && avgDayGap <= 33) return "monthly";
  if (avgDayGap >= 85 && avgDayGap <= 95) return "quarterly";
  if (avgDayGap >= 350 && avgDayGap <= 380) return "annual";
  return "irregular";
}

interface IncomeClassification {
  isIncome: boolean;
  subtype: "salary" | "investment_income" | "gov_benefit" | "other";
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a transaction classifier deciding whether a merchant's INFLOWS to a user's account represent income, and if so what kind.

You will be given:
- The merchant identifier (display name + brand_slug)
- Statistics over the inflows from this merchant:
  • how many transactions, total + average amount
  • amount variance as a percentage (std dev / mean)
  • first and last date, average gap between transactions in days
  • a cadence hint (weekly/biweekly/monthly/quarterly/annual/one-off/irregular)
- The user's connected accounts (institutions + types + last4s)

Classify the brand into ONE of:

1. "salary" — recurring pay from an employer.
   Decisive signal #1: the merchant is a recognizable employer brand
   (Microsoft, Google, Amazon, Acme Corp, Tata Consultancy Services,
   Deel, ADP, payroll processors) AND the inflows are recurring (≥3
   occurrences with biweekly / semi-monthly / monthly / weekly cadence).
   When BOTH are true, classify as salary even if amount variance is
   high (50%+). Tech salaries include base + RSU vests + bonuses +
   commissions + ESPP refunds, which routinely produce 50–80% variance
   while still being unambiguously salary. Variance alone is NOT a
   disqualifier when the brand is a known employer.

   Decisive signal #2: cadence is highly regular (biweekly or
   semi-monthly) AND amount is stable (variance < 25%) AND 3+
   occurrences, even if the merchant name is opaque (e.g.,
   "DIRECT DEPOSIT", "PAYROLL CR"). Stable wage-shaped pattern is
   enough.

   If neither decisive signal fires, this isn't salary.

2. "investment_income" — dividends, interest payments, coupons.
   Strong signals: merchant is a brokerage / investment platform / bank
   investment arm (RBC Direct Investing, Wealthsimple, Vanguard,
   Fidelity, Schwab, Questrade, Zerodha, Groww, Morgan Stanley) AND
   inflows are recurring or interest-shaped (small periodic amounts).
   Also: any merchant whose display name explicitly contains "interest"
   ("Savings Bank Interest", "Interest Credit", "Bond Coupon").

3. "gov_benefit" — tax refunds, government transfers, child benefits.
   Strong signals: merchant is a government / tax authority (CRA, IRS,
   HMRC, Service Canada, ITR, Income Tax Dept). OR the display name
   itself contains "Tax", "Tax Refund", "Tax Payment", "Benefit",
   "Credit" (in a gov sense), "CCB", "GST", "HST", "EI". A single
   one-off inflow labeled as a tax payment / tax refund IS a gov_benefit
   even with no recurring pattern — do not require a recurring cadence
   here.

4. "other" — anything else. Includes:
     • Refunds from merchants (Amazon return, Uber refund, Apple credit)
     • Insurance reimbursements (Sun Life claim, employer reimbursement)
     • Loan disbursements (Fairstone, OneMain, personal loan)
     • Bank fee reversals (NSF return, fee credit)
     • One-off gifts, friend paybacks via e-Transfer
     • ATM cash deposits / mobile cheque deposits of unclear origin
     • Internal transfers we missed
   These all stay uncategorized.

GUIDANCE:
- Be specific in your reasoning — name the merchant and cite the actual
  signals you used. Avoid generic boilerplate. Your reasoning will be
  shown to the user.
- For salary: trust the brand identity over amount variance.
- For gov_benefit: a tax-refund-shaped label IS enough on its own; you
  don't need recurrence.
- For "other": say WHY the brand isn't income (refund / loan / insurance
  / one-off ambiguous), not generic language.

Reply with ONLY JSON, no markdown:
{
  "is_income": boolean,           // true only if subtype is one of salary | investment_income | gov_benefit
  "subtype": "salary" | "investment_income" | "gov_benefit" | "other",
  "confidence": 0.0 to 1.0,
  "reasoning": "one short sentence explaining the decision"
}`;

async function classifyWithClaude(
  profile: BrandInflowProfile,
  accountContext: string,
): Promise<IncomeClassification> {
  const client = getClaudeClient();
  const userPrompt = `Merchant: "${profile.displayName}" (brand_slug: "${profile.brandSlug}")

Inflow profile:
- ${profile.txnCount} transactions
- Total: ${profile.totalAmount.toFixed(2)}
- Average: ${profile.avgAmount.toFixed(2)}
- Min: ${profile.amountMin.toFixed(2)}  Max: ${profile.amountMax.toFixed(2)}
- Amount variance (std dev / mean): ${profile.amountStdDevPct}%
- First inflow: ${profile.firstDate}  Last inflow: ${profile.lastDate}
- Average gap between inflows: ${profile.avgDayGap} days  (cadence hint: ${profile.cadenceHint})

User's connected accounts: ${accountContext || "(none on file)"}

Classify.`;

  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  const parsed = JSON.parse(extractJson(text)) as {
    is_income: boolean;
    subtype: string;
    confidence: number;
    reasoning: string;
  };

  const validSubtypes: Record<string, IncomeClassification["subtype"]> = {
    salary: "salary",
    investment_income: "investment_income",
    gov_benefit: "gov_benefit",
    other: "other",
  };
  const subtype = validSubtypes[parsed.subtype] ?? "other";
  const isIncome =
    parsed.is_income === true &&
    subtype !== "other" &&
    (subtype === "salary" ||
      subtype === "investment_income" ||
      subtype === "gov_benefit");

  return {
    isIncome,
    subtype,
    confidence:
      typeof parsed.confidence === "number" &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 1
        ? parsed.confidence
        : 0.6,
    reasoning: parsed.reasoning ?? "",
  };
}

// ─── Apply ───────────────────────────────────────────────────────

async function applyIncomeToBrand(
  agentInstanceId: string,
  brandSlug: string,
  systemCategory: string | null,
  confidence: string | null,
  reasoning: string | null,
): Promise<number> {
  const updated = await db
    .update(financeTransactions)
    .set({
      category: "income",
      systemCategory,
      categorizationSource: "ai",
      confidence,
      reasoning,
    })
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        isNull(financeTransactions.category),
        eq(financeTransactions.direction, "in"),
        sql`${financeTransactions.merchantNormalized} IN (
          SELECT merchant_normalized FROM merchant_brands WHERE brand_slug = ${brandSlug}
        )`,
      ),
    )
    .returning({ id: financeTransactions.id });
  return updated.length;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}
