import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  financeAccounts,
  financeTransactions,
  userBrandCategories,
} from "@artifigenz/db";
import { getClaudeClient } from "../lib/claude-client";

/**
 * Fee & interest detection (Stage 2.3, fourth slice).
 *
 * "fee_interest" covers charges levied BY a financial institution ON the
 * user — overdraft fees, monthly maintenance, NSF, wire fees, ATM fees,
 * annual card fees, foreign transaction fees, and pure interest charges.
 *
 * Subtypes (kept for future use; UI shows them flat):
 *   bank_fee, interest_charge, other_fee
 *
 * Architecture mirrors detectSubscriptions: per-brand LLM decisions,
 * cache in user_brand_categories. The single biggest signal for fees
 * is the transaction description — "MONTHLY FEE", "INTEREST CHARGE",
 * "OVERDRAFT" etc. — so we pass up to 5 sample descriptions per brand.
 *
 * Runs after internal_transfer + income + subscription. Skips brands
 * already claimed by those.
 *
 * Loan EMI vs. interest_charge: a loan payment with bundled principal +
 * interest is loan_emi (runs next). Only pure interest postings land
 * here.
 */

const LLM_CONCURRENCY = 4;
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

export interface FeeInterestStats {
  candidatesFound: number;
  classifiedAsFee: number;
  classifiedAsNotFee: number;
  cacheHits: number;
  llmErrors: Array<{ brandSlug: string; error: string }>;
  bySubtype: Record<string, number>;
}

export async function detectFeeInterest(
  agentInstanceId: string,
): Promise<FeeInterestStats> {
  const stats: FeeInterestStats = {
    candidatesFound: 0,
    classifiedAsFee: 0,
    classifiedAsNotFee: 0,
    cacheHits: 0,
    llmErrors: [],
    bySubtype: {},
  };

  // Pull brand profiles + a handful of sample descriptions per brand
  // (most-common first). Descriptions are the killer feature for fees.
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
    sample_descriptions: string[];
  }>(sql`
    WITH base AS (
      SELECT
        mb.brand_slug,
        mb.display_name,
        ft.description,
        ft.amount,
        ft.transaction_date
      FROM finance_transactions ft
      INNER JOIN merchant_brands mb
        ON ft.merchant_normalized = mb.merchant_normalized
      WHERE ft.agent_instance_id = ${agentInstanceId}
        AND ft.category IS NULL
        AND ft.direction = 'out'
        AND mb.brand_slug IS NOT NULL
    ),
    desc_freq AS (
      SELECT
        brand_slug,
        description,
        COUNT(*)::int AS n,
        ROW_NUMBER() OVER (PARTITION BY brand_slug ORDER BY COUNT(*) DESC) AS rn
      FROM base
      GROUP BY brand_slug, description
    ),
    top_descs AS (
      SELECT brand_slug, ARRAY_AGG(description ORDER BY n DESC) AS sample_descriptions
      FROM desc_freq
      WHERE rn <= 5
      GROUP BY brand_slug
    )
    SELECT
      b.brand_slug,
      MAX(b.display_name) AS display_name,
      COUNT(*)::int AS txn_count,
      ABS(SUM(b.amount::numeric))::text AS total_amount,
      ABS(AVG(b.amount::numeric))::text AS avg_amount,
      COALESCE(STDDEV_SAMP(ABS(b.amount::numeric)), 0)::text AS amount_stddev,
      ABS(MAX(b.amount::numeric))::text AS amount_min,
      ABS(MIN(b.amount::numeric))::text AS amount_max,
      MIN(b.transaction_date)::text AS first_date,
      MAX(b.transaction_date)::text AS last_date,
      COUNT(DISTINCT b.transaction_date)::int AS distinct_dates,
      GREATEST(MAX(b.transaction_date) - MIN(b.transaction_date), 1)::int AS span_days,
      td.sample_descriptions
    FROM base b
    LEFT JOIN top_descs td USING (brand_slug)
    GROUP BY b.brand_slug, td.sample_descriptions
    ORDER BY txn_count DESC
  `);

  stats.candidatesFound = profiles.length;
  if (profiles.length === 0) return stats;

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

  // Categories already owned by other detectors — no need to re-classify.
  const DEFINITIVE_NOT_FEE = new Set([
    "internal_transfer",
    "income",
    "subscription",
    "loan_emi",
    "variable_recurring",
    "miscellaneous",
  ]);

  for (const p of profiles) {
    const hit = cacheMap.get(p.brand_slug);
    if (!hit) continue;
    if (hit.category === "fee_interest") {
      stats.cacheHits++;
      const applied = await applyFeeToBrand(
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
    } else if (DEFINITIVE_NOT_FEE.has(hit.category)) {
      stats.cacheHits++;
    }
    // "other" → fall through; previous detectors haven't seen fees.
  }

  const uncached = profiles.filter((p) => {
    const hit = cacheMap.get(p.brand_slug);
    if (!hit) return true;
    if (hit.category === "fee_interest") return false;
    if (DEFINITIVE_NOT_FEE.has(hit.category)) return false;
    return true;
  });
  if (uncached.length === 0) return stats;

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
              category: result.isFee ? "fee_interest" : "other",
              systemCategory: result.isFee ? result.subtype : null,
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
                category: result.isFee ? "fee_interest" : "other",
                systemCategory: result.isFee ? result.subtype : null,
                confidence: result.confidence.toFixed(2),
                source: "llm",
                reasoning: result.reasoning,
                updatedAt: new Date(),
              },
            });

          if (result.isFee) {
            const applied = await applyFeeToBrand(
              agentInstanceId,
              p.brand_slug,
              result.subtype,
              result.confidence.toFixed(2),
              result.reasoning,
            );
            if (applied > 0) {
              stats.classifiedAsFee++;
              stats.bySubtype[result.subtype] =
                (stats.bySubtype[result.subtype] ?? 0) + applied;
            }
          } else {
            stats.classifiedAsNotFee++;
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

interface BrandFeeProfile {
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
  sampleDescriptions: string[];
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
  sample_descriptions: string[] | null;
}): BrandFeeProfile {
  const avg = parseFloat(row.avg_amount);
  const stddev = parseFloat(row.amount_stddev);
  const avgDayGap =
    row.distinct_dates > 1 ? row.span_days / (row.distinct_dates - 1) : 0;
  return {
    brandSlug: row.brand_slug,
    displayName: row.display_name,
    txnCount: row.txn_count,
    totalAmount: parseFloat(row.total_amount),
    avgAmount: avg,
    amountStdDevPct: avg > 0 ? Math.round((stddev / avg) * 100) : 0,
    amountMin: parseFloat(row.amount_min),
    amountMax: parseFloat(row.amount_max),
    firstDate: row.first_date,
    lastDate: row.last_date,
    avgDayGap: Math.round(avgDayGap),
    cadenceHint: classifyCadence(avgDayGap, row.txn_count),
    sampleDescriptions: row.sample_descriptions ?? [],
  };
}

function classifyCadence(avgDayGap: number, txnCount: number): string {
  if (txnCount <= 1) return "one-off";
  if (avgDayGap >= 6 && avgDayGap <= 8) return "weekly";
  if (avgDayGap >= 12 && avgDayGap <= 16) return "biweekly";
  if (avgDayGap >= 27 && avgDayGap <= 33) return "monthly";
  if (avgDayGap >= 85 && avgDayGap <= 95) return "quarterly";
  if (avgDayGap >= 350 && avgDayGap <= 380) return "annual";
  return "irregular";
}

const FEE_SUBTYPES = ["bank_fee", "interest_charge", "other_fee"] as const;
type FeeSubtype = (typeof FEE_SUBTYPES)[number];

interface FeeClassification {
  isFee: boolean;
  subtype: FeeSubtype | "other";
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a transaction classifier deciding whether a merchant's OUTFLOWS from a user's account represent a FEE OR INTEREST CHARGE levied by a financial institution.

You will be given:
- Merchant identifier (display name + brand_slug)
- Outflow stats: count, total + average amount, amount variance %, date range, cadence
- Up to 5 sample transaction descriptions (most-common first) — this is the strongest signal for fees
- The user's connected accounts (institutions + last4s)

Classify into ONE of these subtypes (set is_fee=true for any of the three; false for "other"):

1. "bank_fee" — Fees charged BY a bank or card issuer FOR services or
   account-keeping. Examples:
     • Monthly account maintenance fee
     • Overdraft fee, NSF fee, returned-item fee
     • ATM fee (own bank or third-party)
     • Wire transfer fee, foreign transaction fee
     • Cash advance fee
     • Annual card fee, replacement card fee
     • Stop-payment fee, paper-statement fee
   Sample descriptions often contain: "FEE", "CHARGE", "OVERDRAFT", "NSF",
   "MAINTENANCE", "ATM", "WIRE", "ANNUAL", "FOREIGN", "SERVICE CHARGE".

2. "interest_charge" — Pure interest postings (not bundled with principal).
   Credit card interest charge, line of credit interest, overdraft interest.
   Sample descriptions often contain: "INTEREST", "FINANCE CHARGE",
   "INTEREST CHARGE ON PURCHASES", "LINE OF CREDIT INTEREST".

3. "other_fee" — Clearly a fee or finance-related charge but doesn't fit
   the two above (e.g., tax-prep service fee from your bank's portal,
   investment account fee). Use sparingly; prefer "other" if unsure.

4. "other" (is_fee=false) — NOT a fee or interest. Anything where:
     • The merchant is a real product or service brand (Netflix, Amazon,
       grocery, gas, restaurant). These are spending, not fees.
     • It's a loan/mortgage EMI payment (principal + interest bundled).
       Loan_emi is a separate category; we don't claim it here.
     • It's a subscription, internal transfer, or income.
     • Descriptions show typical merchant patterns ("PURCHASE", store
       name, item name) rather than fee language.

DECISION RULES:
- The transaction descriptions are the strongest signal. "INTEREST CHARGE
  ON PURCHASES" → interest_charge regardless of brand. "MONTHLY MAINTENANCE
  FEE" → bank_fee regardless of brand. Don't second-guess explicit fee
  language.
- Bank-issued fees almost always come from the bank brand itself (RBC, TD,
  Chase, etc.) AND have fee/charge language. A charge from a bank brand
  without fee language is more likely a transfer or loan payment, not a
  fee.
- Fees are typically small (under ~$100). A $500+ charge labeled "FEE" is
  suspicious — consider whether it might be a misclassified merchant or
  loan payment.
- Pure interest postings have descriptions like "INTEREST CHARGE",
  "FINANCE CHARGE", not "PAYMENT" or "PURCHASE".

GUIDANCE:
- If descriptions clearly say "INTEREST" → interest_charge.
- If descriptions clearly say "FEE" or "CHARGE" → bank_fee.
- If brand is a bank/card issuer AND amount is small AND no other clear
  category fits → likely bank_fee.
- Reasoning should reference the specific descriptions or amounts you saw.
  Avoid generic boilerplate.

Reply with ONLY JSON, no markdown:
{
  "is_fee": boolean,
  "subtype": "bank_fee" | "interest_charge" | "other_fee" | "other",
  "confidence": 0.0 to 1.0,
  "reasoning": "one short sentence"
}`;

async function classifyWithClaude(
  profile: BrandFeeProfile,
  accountContext: string,
): Promise<FeeClassification> {
  const client = getClaudeClient();
  const descBlock =
    profile.sampleDescriptions.length > 0
      ? profile.sampleDescriptions.map((d) => `  - "${d}"`).join("\n")
      : "  (no description samples)";
  const userPrompt = `Merchant: "${profile.displayName}" (brand_slug: "${profile.brandSlug}")

Sample transaction descriptions (most-common first):
${descBlock}

Outflow profile:
- ${profile.txnCount} charges
- Total: ${profile.totalAmount.toFixed(2)}
- Average: ${profile.avgAmount.toFixed(2)}
- Min: ${profile.amountMin.toFixed(2)}  Max: ${profile.amountMax.toFixed(2)}
- Amount variance (std dev / mean): ${profile.amountStdDevPct}%
- First: ${profile.firstDate}  Last: ${profile.lastDate}
- Cadence: ${profile.cadenceHint} (avg gap ${profile.avgDayGap}d)

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
    is_fee: boolean;
    subtype: string;
    confidence: number;
    reasoning: string;
  };

  const subtype = (FEE_SUBTYPES as readonly string[]).includes(parsed.subtype)
    ? (parsed.subtype as FeeSubtype)
    : "other";
  const isFee = parsed.is_fee === true && subtype !== "other";

  return {
    isFee,
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

// Description-level signal-word filter. When the brand resolver collapses
// unrelated merchants under one brand_slug (Plaid sometimes does this for
// generic terms like "purchase interest" or "utility"), the LLM's verdict
// is correct for the dominant descriptions but the UPDATE shouldn't sweep
// up unrelated rows. Require each tagged row to actually mention a fee or
// interest signal word.
const FEE_DESCRIPTION_REGEX =
  "\\y(fee|charge|interest|nsf|overdraft|overlimit|maintenance|annual|wire|atm|finance|return|service)\\y";

async function applyFeeToBrand(
  agentInstanceId: string,
  brandSlug: string,
  systemCategory: string | null,
  confidence: string | null,
  reasoning: string | null,
): Promise<number> {
  const updated = await db
    .update(financeTransactions)
    .set({
      category: "fee_interest",
      systemCategory,
      categorizationSource: "ai",
      confidence,
      reasoning,
    })
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        isNull(financeTransactions.category),
        eq(financeTransactions.direction, "out"),
        sql`${financeTransactions.merchantNormalized} IN (
          SELECT merchant_normalized FROM merchant_brands WHERE brand_slug = ${brandSlug}
        )`,
        sql`LOWER(${financeTransactions.description}) ~ ${FEE_DESCRIPTION_REGEX}`,
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
