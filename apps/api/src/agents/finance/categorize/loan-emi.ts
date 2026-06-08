import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  financeAccounts,
  financeTransactions,
  userBrandCategories,
} from "@artifigenz/db";
import { getClaudeClient } from "../lib/claude-client";

/**
 * Loan EMI detection (Stage 2.3, fifth slice).
 *
 * "loan_emi" covers recurring repayments toward a borrowed principal:
 * mortgages, auto loans, personal loans, student loans, credit card EMIs,
 * lines of credit (when paid in fixed installments).
 *
 * Subtypes (kept for future use; UI shows them flat):
 *   mortgage, auto_loan, personal_loan, student_loan, credit_card_emi,
 *   other_loan
 *
 * Architecture mirrors fee_interest: per-brand LLM call with sample
 * descriptions (the strongest signal), shared user_brand_categories cache,
 * description-word guard on apply to survive brand-slug collapses.
 *
 * Runs after fee_interest. EMIs and pure interest charges are distinct:
 * an EMI is principal + interest bundled in one posting (usually a round-
 * ish amount with monthly cadence); a pure interest line is just the
 * interest accrual. The fee_interest detector already claimed the latter.
 */

const LLM_CONCURRENCY = 4;
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

export interface LoanEmiStats {
  candidatesFound: number;
  classifiedAsLoan: number;
  classifiedAsNotLoan: number;
  cacheHits: number;
  llmErrors: Array<{ brandSlug: string; error: string }>;
  bySubtype: Record<string, number>;
}

export async function detectLoanEmi(
  agentInstanceId: string,
): Promise<LoanEmiStats> {
  const stats: LoanEmiStats = {
    candidatesFound: 0,
    classifiedAsLoan: 0,
    classifiedAsNotLoan: 0,
    cacheHits: 0,
    llmErrors: [],
    bySubtype: {},
  };

  // Aggregate at merchant_normalized level — NOT collapsed by brand_slug.
  // Plaid's brand resolver occasionally lumps unrelated merchants under
  // one slug (e.g., `fairstone` covering the EMI line, a $6K wire, and a
  // POS purchase). When that happens, brand-level stats are useless and
  // the LLM (correctly) refuses to call the whole brand a loan.
  //
  // By keeping per-merchant breakdowns we hand the LLM clean signal per
  // merchant and let it pick which ones (if any) are loans.
  const rawRows = await db.execute<{
    brand_slug: string;
    display_name: string;
    merchant_normalized: string;
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
    amount_distribution: Array<{ amount: number; count: number }> | null;
  }>(sql`
    WITH base AS (
      SELECT
        mb.brand_slug,
        mb.display_name,
        ft.merchant_normalized,
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
        merchant_normalized,
        description,
        COUNT(*)::int AS n,
        ROW_NUMBER() OVER (PARTITION BY merchant_normalized ORDER BY COUNT(*) DESC) AS rn
      FROM base
      GROUP BY merchant_normalized, description
    ),
    top_descs AS (
      SELECT merchant_normalized, ARRAY_AGG(description ORDER BY n DESC) AS sample_descriptions
      FROM desc_freq
      WHERE rn <= 5
      GROUP BY merchant_normalized
    ),
    -- Per-merchant amount distribution. We bucket amounts to nearest cent
    -- so true-recurring charges (always the same amount) cluster cleanly.
    -- The LLM uses this to spot multi-stream patterns (BNPL: several
    -- concurrent monthly installment plans under one merchant). A small
    -- handful of dominant amounts each repeating monthly = installment
    -- stack, regardless of aggregate variance.
    amount_freq AS (
      SELECT
        merchant_normalized,
        amt,
        n,
        ROW_NUMBER() OVER (PARTITION BY merchant_normalized ORDER BY n DESC, amt DESC) AS rn
      FROM (
        SELECT
          merchant_normalized,
          ROUND(ABS(amount::numeric), 2) AS amt,
          COUNT(*)::int AS n
        FROM base
        GROUP BY merchant_normalized, ROUND(ABS(amount::numeric), 2)
      ) AS amt_grouped
    ),
    top_amounts AS (
      SELECT
        merchant_normalized,
        JSONB_AGG(JSONB_BUILD_OBJECT('amount', amt, 'count', n) ORDER BY n DESC) AS amount_distribution
      FROM amount_freq
      WHERE rn <= 6
      GROUP BY merchant_normalized
    )
    SELECT
      b.brand_slug,
      MAX(b.display_name) AS display_name,
      b.merchant_normalized,
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
      td.sample_descriptions,
      ta.amount_distribution
    FROM base b
    LEFT JOIN top_descs td USING (merchant_normalized)
    LEFT JOIN top_amounts ta USING (merchant_normalized)
    GROUP BY b.brand_slug, b.merchant_normalized, td.sample_descriptions, ta.amount_distribution
    ORDER BY b.brand_slug, txn_count DESC
  `);

  // Group merchants under their brand. profiles[brand_slug] = list of merchant profiles.
  type MerchantProfile = ReturnType<typeof buildMerchantProfile>;
  const profiles = new Map<
    string,
    { displayName: string; merchants: MerchantProfile[] }
  >();
  for (const r of rawRows) {
    const merchant = buildMerchantProfile(r);
    let bucket = profiles.get(r.brand_slug);
    if (!bucket) {
      bucket = { displayName: r.display_name, merchants: [] };
      profiles.set(r.brand_slug, bucket);
    }
    bucket.merchants.push(merchant);
  }

  stats.candidatesFound = profiles.size;
  if (profiles.size === 0) return stats;

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

  const brandSlugs = Array.from(profiles.keys());
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

  const DEFINITIVE_NOT_LOAN = new Set([
    "internal_transfer",
    "income",
    "subscription",
    "fee_interest",
    "variable_recurring",
    "miscellaneous",
  ]);

  // Cache hits: replay the cached verdict on the merchants currently
  // uncategorized. We don't store per-merchant tagging in the cache (yet),
  // so a "loan_emi" cache verdict reapplies the LLM's UPDATE across all
  // merchants under the brand whose descriptions match loan/EMI language.
  // For "DEFINITIVE_NOT_LOAN" hits we just skip — those merchants are
  // already owned by another detector or pinned to miscellaneous.
  const llmCandidates: Array<{
    brandSlug: string;
    displayName: string;
    merchants: MerchantProfile[];
  }> = [];

  for (const [brandSlug, bucket] of profiles) {
    const hit = cacheMap.get(brandSlug);
    if (!hit) {
      llmCandidates.push({ brandSlug, ...bucket });
      continue;
    }
    if (hit.category === "loan_emi") {
      // Cache hits replay the verdict at the brand level (which streams
      // were tagged isn't stored in the cache — yet). For now we re-run
      // the LLM by treating the cache hit as a hint that this brand
      // likely has loan content, but we don't blanket-tag. Easier path:
      // skip cache replay for loan_emi and let the LLM re-classify so
      // it can choose the streams again. Costs a bit but stays correct.
      stats.cacheHits++;
      llmCandidates.push({ brandSlug, ...bucket });
    } else if (DEFINITIVE_NOT_LOAN.has(hit.category)) {
      stats.cacheHits++;
    } else {
      // "other" verdict from another detector — give loan a chance too.
      llmCandidates.push({ brandSlug, ...bucket });
    }
  }

  if (llmCandidates.length === 0) return stats;

  let idx = 0;
  const workers = Array.from(
    { length: Math.min(LLM_CONCURRENCY, llmCandidates.length) },
    async () => {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= llmCandidates.length) return;
        const c = llmCandidates[myIdx];
        try {
          const result = await classifyWithClaude(
            c.brandSlug,
            c.displayName,
            c.merchants,
            accountContext,
          );

          // Validate that tagged_streams reference merchants that actually
          // exist in this brand. LLMs occasionally hallucinate names.
          const validMerchants = new Set(
            c.merchants.map((m) => m.merchantNormalized),
          );
          const taggedStreams = result.taggedStreams.filter((s) =>
            validMerchants.has(s.merchantNormalized),
          );

          const isLoan = result.isLoan && taggedStreams.length > 0;

          await db
            .insert(userBrandCategories)
            .values({
              agentInstanceId,
              brandSlug: c.brandSlug,
              category: isLoan ? "loan_emi" : "other",
              systemCategory: isLoan ? result.subtype : null,
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
                category: isLoan ? "loan_emi" : "other",
                systemCategory: isLoan ? result.subtype : null,
                confidence: result.confidence.toFixed(2),
                source: "llm",
                reasoning: result.reasoning,
                updatedAt: new Date(),
              },
            });

          if (isLoan) {
            const applied = await applyLoanToStreams(
              agentInstanceId,
              taggedStreams,
              result.subtype,
              result.confidence.toFixed(2),
              result.reasoning,
            );
            if (applied > 0) {
              stats.classifiedAsLoan++;
              stats.bySubtype[result.subtype] =
                (stats.bySubtype[result.subtype] ?? 0) + applied;
            }
          } else {
            stats.classifiedAsNotLoan++;
          }
        } catch (err) {
          stats.llmErrors.push({
            brandSlug: c.brandSlug,
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

interface MerchantProfile {
  merchantNormalized: string;
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
  amountDistribution: Array<{ amount: number; count: number }>;
}

function buildMerchantProfile(row: {
  merchant_normalized: string;
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
  amount_distribution: Array<{ amount: number; count: number }> | null;
}): MerchantProfile {
  const avg = parseFloat(row.avg_amount);
  const stddev = parseFloat(row.amount_stddev);
  const avgDayGap =
    row.distinct_dates > 1 ? row.span_days / (row.distinct_dates - 1) : 0;
  return {
    merchantNormalized: row.merchant_normalized,
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
    amountDistribution: row.amount_distribution ?? [],
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

const LOAN_SUBTYPES = [
  "mortgage",
  "auto_loan",
  "personal_loan",
  "student_loan",
  "credit_card_emi",
  "other_loan",
] as const;
type LoanSubtype = (typeof LOAN_SUBTYPES)[number];

interface TaggedStream {
  merchantNormalized: string;
  // null = tag every transaction under the merchant. Specific amount = only
  // tag rows whose amount rounds to this value (for multi-stream merchants
  // where individual installment streams need to be isolated).
  amount: number | null;
}

interface LoanClassification {
  isLoan: boolean;
  subtype: LoanSubtype | "other";
  taggedStreams: TaggedStream[];
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a transaction classifier deciding which (if any) merchants under a brand represent LOAN EMI / INSTALLMENT REPAYMENTS — recurring scheduled payments toward a borrowed principal (principal + interest bundled into one posting).

You will be given:
- A brand (display_name + brand_slug)
- A list of "merchants" under this brand. Each merchant has its own outflow profile, including up to 5 sample transaction descriptions.
- The user's connected accounts (institutions + last4s)

IMPORTANT: The same brand may contain MULTIPLE distinct merchants because brand resolution can collapse unrelated transaction patterns. Examples:
  - A lender brand may have one merchant_normalized for the recurring EMI line and a separate merchant_normalized for the initial loan disbursement (single large amount) or a POS retail purchase. Only the recurring fixed-amount merchant is an EMI.
  - A bank brand may have one merchant_normalized for "INTEREST CHARGE" (already handled) and one for "AUTO LOAN PMT" (this is your job).

Your job: identify which specific merchants (by their merchant_normalized key) represent loan EMIs, ignoring the others.

Classify the brand into ONE of these subtypes (set is_loan=true if you tag any merchants, else false):

1. "mortgage" — Home mortgage / housing loan installments.
   Sample descriptions often contain: "MORTGAGE", "MTG", "HOME LOAN", "HOUSING LOAN".

2. "auto_loan" — Car / vehicle / auto loan installments.
   Sample descriptions often contain: "AUTO LOAN", "CAR LOAN", "VEHICLE LOAN", "AUTO PMT", "VEHICLE FINANCE".

3. "personal_loan" — Unsecured personal-loan installments.
   Sample descriptions often contain: "PERSONAL LOAN", "PL EMI", "INSTALLMENT LOAN", lender names + "LOAN PMT".

4. "student_loan" — Student / education loan installments.
   Sample descriptions often contain: "STUDENT LOAN", "EDU LOAN", "EDUCATION LOAN", "NSLSC", "SALLIE MAE", "NELNET", "GREAT LAKES".

5. "credit_card_emi" — Credit-card EMI conversion installments. NOT the full statement payment — specifically the per-month EMI portion when a purchase has been converted to installments.
   Sample descriptions often contain: "EMI", "INSTALLMENT", "CC EMI".

6. "other_loan" — Clearly a loan installment but doesn't fit the five above. Use sparingly.

7. "other" (is_loan=false, tagged_merchants=[]) — None of the merchants under this brand are loan EMIs.

PER-MERCHANT DECISION RULES:
- The merchant's transaction descriptions are the strongest signal. "MORTGAGE PAYMENT" or "AUTO LOAN PMT" → tag that merchant.
- True EMIs have fixed amounts (variance < 5%) and monthly cadence (gap 27-33 days). Floating-rate mortgages may shift slightly — still loan, note the shift in reasoning.
- "PAYMENT - THANK YOU" or "PAYMENT RECEIVED" to a credit-card brand is NOT an EMI — it's a transfer to pay off the card. Do not tag.
- A one-off large amount (variance dimension doesn't apply) is NOT EMI — could be loan disbursement or balance transfer.
- A merchant with no loan-language descriptions, irregular cadence, and variable amounts is NOT EMI even if the brand_slug sounds like a lender.

STREAM-LEVEL TAGGING (this is the key idea):
You tag INSTALLMENT STREAMS, not whole merchants. A stream is a sequence
of charges at the SAME fixed amount, recurring on a regular cadence.

In the response, "tagged_streams" is a list of {merchant_normalized, amount}
pairs:
  - amount = null → tag every transaction under this merchant. Use this
    when the merchant has ONE clean recurring amount (or all charges look
    like the same EMI plan).
  - amount = <number> → tag only transactions whose absolute amount rounds
    to this exact value. Use this when one merchant hosts MULTIPLE
    concurrent installment plans plus outliers; you isolate each stream.

MULTI-STREAM PATTERN (use amount_distribution to spot it):
A single merchant_normalized sometimes hosts SEVERAL CONCURRENT installment
plans — common for any lender that lets a user open multiple parallel
installments (BNPL providers, credit-card EMI conversions, lines of credit
split across products). The aggregate stats hide this: variance looks high,
cadence looks irregular. BUT the amount_distribution reveals it: 2-4
distinct round amounts each appearing 3+ times, often plus a few outliers
(the initial purchase posts BEFORE being split into installments — those
are NOT EMI payments and should NOT be tagged).

When you see this pattern AND the descriptions / brand identity match a
lender or installment-credit provider, emit one tagged_streams entry per
recurring amount band (with that amount), and OMIT the outlier amounts.
Pick personal_loan or credit_card_emi based on the merchant's primary
product. Note in the reasoning which amounts are the parallel streams and
which ones you skipped as outliers.

If the amount_distribution shows ONE dominant amount with monthly cadence
and loan-language descriptions, emit a single entry with amount=null (or
that exact amount — both work for the clean single-stream case).

GUIDANCE:
- Be conservative. If a merchant's pattern doesn't clearly match the EMI shape (fixed monthly amount + loan-language descriptions), do NOT include it in tagged_merchants. It's better to miss an ambiguous loan than to falsely tag rent, retail purchases, or one-off transfers.
- The subtype is for the WHOLE brand. If multiple merchants are tagged and they look like different products, pick the most likely subtype based on the dominant pattern.
- Reasoning should reference specific merchants and the descriptions or amounts you saw. Avoid generic boilerplate.

Reply with ONLY JSON, no markdown:
{
  "is_loan": boolean,
  "subtype": "mortgage" | "auto_loan" | "personal_loan" | "student_loan" | "credit_card_emi" | "other_loan" | "other",
  "tagged_streams": [
    { "merchant_normalized": "<key>", "amount": null }     // tag every txn under this merchant
    // or
    { "merchant_normalized": "<key>", "amount": 112.32 }   // tag only txns of this amount
  ],
  "confidence": 0.0 to 1.0,
  "reasoning": "one short sentence"
}`;

async function classifyWithClaude(
  brandSlug: string,
  displayName: string,
  merchants: MerchantProfile[],
  accountContext: string,
): Promise<LoanClassification> {
  const client = getClaudeClient();
  const merchantBlock = merchants
    .map((m, i) => {
      const descs =
        m.sampleDescriptions.length > 0
          ? m.sampleDescriptions.map((d) => `      - "${d}"`).join("\n")
          : "      (no description samples)";
      const amounts =
        m.amountDistribution.length > 0
          ? m.amountDistribution
              .map(
                (a) =>
                  `      $${a.amount.toFixed(2)} × ${a.count}`,
              )
              .join("\n")
          : "      (no distribution available)";
      return `  Merchant ${i + 1}: merchant_normalized="${m.merchantNormalized}"
    Sample descriptions:
${descs}
    Amount distribution (top distinct amounts × occurrences):
${amounts}
    Stats: ${m.txnCount} charges, total ${m.totalAmount.toFixed(2)}, avg ${m.avgAmount.toFixed(2)}, min ${m.amountMin.toFixed(2)}, max ${m.amountMax.toFixed(2)}, variance ${m.amountStdDevPct}%, cadence ${m.cadenceHint} (avg gap ${m.avgDayGap}d), first ${m.firstDate}, last ${m.lastDate}`;
    })
    .join("\n\n");

  const userPrompt = `Brand: "${displayName}" (brand_slug: "${brandSlug}")

Merchants under this brand (${merchants.length}):

${merchantBlock}

User's connected accounts: ${accountContext || "(none on file)"}

For each merchant, decide whether it hosts loan EMI streams. Return tagged_streams listing the (merchant_normalized, amount) pairs to tag. For a clean single-stream merchant set amount=null. For a multi-stream merchant emit one entry per recurring amount band and skip outliers.`;

  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  const parsed = JSON.parse(extractJson(text)) as {
    is_loan: boolean;
    subtype: string;
    tagged_streams?: Array<{
      merchant_normalized?: string;
      amount?: number | null;
    }>;
    confidence: number;
    reasoning: string;
  };

  const subtype = (LOAN_SUBTYPES as readonly string[]).includes(parsed.subtype)
    ? (parsed.subtype as LoanSubtype)
    : "other";

  const taggedStreams: TaggedStream[] = Array.isArray(parsed.tagged_streams)
    ? parsed.tagged_streams
        .filter(
          (s): s is { merchant_normalized: string; amount?: number | null } =>
            typeof s?.merchant_normalized === "string",
        )
        .map((s) => ({
          merchantNormalized: s.merchant_normalized,
          amount:
            typeof s.amount === "number" && Number.isFinite(s.amount)
              ? Math.round(s.amount * 100) / 100
              : null,
        }))
    : [];

  const isLoan =
    parsed.is_loan === true && subtype !== "other" && taggedStreams.length > 0;

  return {
    isLoan,
    subtype,
    taggedStreams,
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

async function applyLoanToStreams(
  agentInstanceId: string,
  streams: TaggedStream[],
  systemCategory: string | null,
  confidence: string | null,
  reasoning: string | null,
): Promise<number> {
  if (streams.length === 0) return 0;

  // Split: merchant-wide tags (amount=null) vs. amount-specific stream tags.
  const wholeMerchants: string[] = [];
  const amountStreams: Array<{ merchant: string; amount: number }> = [];
  for (const s of streams) {
    if (s.amount === null) wholeMerchants.push(s.merchantNormalized);
    else amountStreams.push({ merchant: s.merchantNormalized, amount: s.amount });
  }

  let total = 0;

  if (wholeMerchants.length > 0) {
    const updated = await db
      .update(financeTransactions)
      .set({
        category: "loan_emi",
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
          inArray(financeTransactions.merchantNormalized, wholeMerchants),
        ),
      )
      .returning({ id: financeTransactions.id });
    total += updated.length;
  }

  // Amount-specific stream tags. Each (merchant, amount) maps to rows whose
  // abs(amount) rounded to 2dp matches exactly. We fire one UPDATE per
  // stream because batching into a single query with OR-of-AND gets ugly
  // and there are typically only a handful per brand.
  for (const s of amountStreams) {
    const updated = await db
      .update(financeTransactions)
      .set({
        category: "loan_emi",
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
          eq(financeTransactions.merchantNormalized, s.merchant),
          sql`ROUND(ABS(${financeTransactions.amount}::numeric), 2) = ${s.amount}`,
        ),
      )
      .returning({ id: financeTransactions.id });
    total += updated.length;
  }

  return total;
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
