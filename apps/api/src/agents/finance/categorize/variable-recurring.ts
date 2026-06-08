import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  financeAccounts,
  financeTransactions,
  userBrandCategories,
} from "@artifigenz/db";
import { getClaudeClient } from "../lib/claude-client";

/**
 * Variable recurring detection (Stage 2.3, sixth slice).
 *
 * "variable_recurring" covers outflows that recur on a regular cadence
 * but with variable amounts — utility bills, telecom / internet bills,
 * insurance premiums, habitual grocery / fuel spend, transit, household
 * services. Distinct from subscription (fixed amount) and loan_emi
 * (fixed installment principal+interest).
 *
 * Subtypes (kept for future use; UI shows them flat):
 *   utility, telecom, insurance, groceries, fuel_transport,
 *   household_services, other_variable_recurring
 *
 * Architecture mirrors loan_emi: per-merchant profiles + amount
 * distribution, LLM picks tagged_streams (merchant + optional amount),
 * apply tags only matched (merchant, amount) tuples. The cache stays
 * brand-keyed.
 *
 * Runs after loan_emi (last detector before miscellaneous catch-all).
 * Pre-condition: internal_transfer, income, subscription, fee_interest,
 * loan_emi have already claimed everything that fits them.
 *
 * Conservative: 3+ occurrences required (cadence visible). One-off or
 * irregular merchant patterns stay uncategorized.
 */

const LLM_CONCURRENCY = 4;
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

export interface VariableRecurringStats {
  candidatesFound: number;
  classifiedAsVarRecurring: number;
  classifiedAsNot: number;
  cacheHits: number;
  llmErrors: Array<{ brandSlug: string; error: string }>;
  bySubtype: Record<string, number>;
}

export async function detectVariableRecurring(
  agentInstanceId: string,
): Promise<VariableRecurringStats> {
  const stats: VariableRecurringStats = {
    candidatesFound: 0,
    classifiedAsVarRecurring: 0,
    classifiedAsNot: 0,
    cacheHits: 0,
    llmErrors: [],
    bySubtype: {},
  };

  // Per-merchant aggregation + amount distribution. Min 3 charges filters
  // out one-offs early (less LLM cost, fewer false positives).
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
    HAVING COUNT(*) >= 3
    ORDER BY b.brand_slug, txn_count DESC
  `);

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

  // Every prior detector has had its chance. If the cache says this
  // brand is something else definitively, skip. Otherwise re-run the LLM
  // because the cache doesn't store stream-level decisions.
  const DEFINITIVE_NOT_VAR = new Set([
    "internal_transfer",
    "income",
    "subscription",
    "fee_interest",
    "loan_emi",
    "miscellaneous",
  ]);

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
    if (DEFINITIVE_NOT_VAR.has(hit.category)) {
      stats.cacheHits++;
    } else {
      // "other" verdicts from prior detectors or our own — let LLM revisit.
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

          const validMerchants = new Set(
            c.merchants.map((m) => m.merchantNormalized),
          );
          const taggedStreams = result.taggedStreams.filter((s) =>
            validMerchants.has(s.merchantNormalized),
          );

          const isVar = result.isVariableRecurring && taggedStreams.length > 0;

          await db
            .insert(userBrandCategories)
            .values({
              agentInstanceId,
              brandSlug: c.brandSlug,
              category: isVar ? "variable_recurring" : "other",
              systemCategory: isVar ? result.subtype : null,
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
                category: isVar ? "variable_recurring" : "other",
                systemCategory: isVar ? result.subtype : null,
                confidence: result.confidence.toFixed(2),
                source: "llm",
                reasoning: result.reasoning,
                updatedAt: new Date(),
              },
            });

          if (isVar) {
            const applied = await applyVarRecurringToStreams(
              agentInstanceId,
              taggedStreams,
              result.subtype,
              result.confidence.toFixed(2),
              result.reasoning,
            );
            if (applied > 0) {
              stats.classifiedAsVarRecurring++;
              stats.bySubtype[result.subtype] =
                (stats.bySubtype[result.subtype] ?? 0) + applied;
            }
          } else {
            stats.classifiedAsNot++;
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

const VAR_SUBTYPES = [
  "utility",
  "telecom",
  "insurance",
  "household_services",
  "other_variable_recurring",
] as const;
type VarSubtype = (typeof VAR_SUBTYPES)[number];

interface TaggedStream {
  merchantNormalized: string;
  amount: number | null;
}

interface VarClassification {
  isVariableRecurring: boolean;
  subtype: VarSubtype | "other";
  taggedStreams: TaggedStream[];
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a transaction classifier deciding which (if any) merchants under a brand represent VARIABLE RECURRING BILLS — CONTRACTED recurring charges from a service provider that vary in amount cycle-to-cycle.

The key word is CONTRACTED. The user has an account / agreement with this provider, the provider bills them on a schedule, and the user owes them. Utilities, telecom, insurance, and similar household-services accounts are the canonical examples.

You will be given:
- A brand (display_name + brand_slug)
- A list of "merchants" under this brand, each with its own profile, sample descriptions, and an amount distribution
- The user's connected accounts

WHAT GOES HERE (set is_variable_recurring=true if you tag any streams):

1. "utility" — Electricity, natural gas, water, sewer, waste / garbage. Bill language in descriptions. Monthly cadence typical, amounts swing seasonally.

2. "telecom" — Mobile phone, landline, internet, cable / TV (not streaming subscriptions). Monthly cadence, slight amount variance from data overages or promotional rollovers.

3. "insurance" — Home, auto, life, health insurance premiums charged directly to the user. Monthly or quarterly cadence. Variance from rate changes or coverage adjustments.

4. "household_services" — Ongoing contracted services billed on a schedule: cleaning, lawn care, pest control, pool service, security monitoring, property management fees.

5. "other_variable_recurring" — Clearly a CONTRACTED variable recurring bill that doesn't fit the four above (e.g., usage-based cloud infrastructure bills like AWS / Vercel / Neon where the user has an account that bills monthly with variable usage). Use sparingly.

WHAT DOES NOT GO HERE (return is_variable_recurring=false):

- Fixed-amount recurring charges → those are "subscription", already classified upstream.
- Internal transfers, income, fees / interest, loan EMIs → already classified.
- Genuinely one-off purchases (only 1-2 occurrences with no cadence).
- HABITUAL DISCRETIONARY SPENDING at the same merchant. This is the most common false positive — the user buys gas at the same brand every couple of weeks, or grocery-shops at the same store, or eats at the same restaurant chain frequently. The recurring CADENCE is a behavioral pattern, not a bill. There's no contract, no scheduled debit, no provider sending an invoice. These belong in miscellaneous, not here.
  Examples that look recurring but are NOT variable_recurring:
    • Gas stations (fuel purchases at retail) — even if visited monthly
    • Grocery stores / supermarkets — even if visited weekly
    • Restaurants / coffee shops / fast food
    • Retail stores (clothing, hardware, etc.)
    • Pharmacies, convenience stores
    • Ride-share (Uber/Lyft) — pay-per-trip, not contracted billing
- Hotel stays, travel bookings, large appliance / electronics purchases.

STREAM-LEVEL TAGGING:
"tagged_streams" is a list of {merchant_normalized, amount} pairs.
  - amount = null → tag every transaction under this merchant (use for clean single-stream merchants where all charges are the same kind of bill).
  - amount = <number> → tag only transactions whose absolute amount rounds to this exact value. Use when one merchant hosts multiple distinct recurring patterns and you want to isolate one (rare for variable_recurring; common for loan_emi instead).

For most variable_recurring merchants, amount=null is correct (all charges are the same bill, just different magnitudes).

DECISION RULES — BE CONSERVATIVE:
- The single test: would this merchant send the user an INVOICE / STATEMENT on a schedule that the user is contractually obligated to pay? If yes → variable_recurring. If no (the user just chose to buy from them) → miscellaneous.
- Trust brand identity. If the brand is clearly a utility, telecom, insurance, or services provider in a known contracted category, lean toward tagging even if amounts vary 30%+.
- Visible cadence is necessary but not sufficient. A user buying gas every two weeks has a cadence, but no contract — not variable_recurring.
- Descriptions are a strong signal. "BILL PAYMENT", "AUTOPAY", "PREAUTHORIZED", "PREMIUM", "UTILITIES", "INVOICE", "AUTO-DEBIT" lean toward variable_recurring. Generic POS / purchase descriptions lean toward NOT.
- When in doubt, DO NOT tag. Miscellaneous is the right default for habitual but discretionary spending.

GUIDANCE:
- The amount_distribution helps you spot whether the variance is around one bill-shaped distribution or multiple distinct patterns.
- Reasoning should reference specific merchants, descriptions, or cadence observed. Avoid generic boilerplate.

Reply with ONLY JSON, no markdown:
{
  "is_variable_recurring": boolean,
  "subtype": "utility" | "telecom" | "insurance" | "household_services" | "other_variable_recurring" | "other",
  "tagged_streams": [
    { "merchant_normalized": "<key>", "amount": null }
    // or { "merchant_normalized": "<key>", "amount": 132.50 }
  ],
  "confidence": 0.0 to 1.0,
  "reasoning": "one short sentence"
}`;

async function classifyWithClaude(
  brandSlug: string,
  displayName: string,
  merchants: MerchantProfile[],
  accountContext: string,
): Promise<VarClassification> {
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
              .map((a) => `      $${a.amount.toFixed(2)} × ${a.count}`)
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

For each merchant, decide whether it represents variable recurring spend. Return tagged_streams. Be conservative — when in doubt, return is_variable_recurring=false and leave the merchant for miscellaneous.`;

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
    is_variable_recurring: boolean;
    subtype: string;
    tagged_streams?: Array<{
      merchant_normalized?: string;
      amount?: number | null;
    }>;
    confidence: number;
    reasoning: string;
  };

  const subtype = (VAR_SUBTYPES as readonly string[]).includes(parsed.subtype)
    ? (parsed.subtype as VarSubtype)
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

  const isVar =
    parsed.is_variable_recurring === true &&
    subtype !== "other" &&
    taggedStreams.length > 0;

  return {
    isVariableRecurring: isVar,
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

async function applyVarRecurringToStreams(
  agentInstanceId: string,
  streams: TaggedStream[],
  systemCategory: string | null,
  confidence: string | null,
  reasoning: string | null,
): Promise<number> {
  if (streams.length === 0) return 0;

  const wholeMerchants: string[] = [];
  const amountStreams: Array<{ merchant: string; amount: number }> = [];
  for (const s of streams) {
    if (s.amount === null) wholeMerchants.push(s.merchantNormalized);
    else
      amountStreams.push({
        merchant: s.merchantNormalized,
        amount: s.amount,
      });
  }

  let total = 0;

  if (wholeMerchants.length > 0) {
    const updated = await db
      .update(financeTransactions)
      .set({
        category: "variable_recurring",
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

  for (const s of amountStreams) {
    const updated = await db
      .update(financeTransactions)
      .set({
        category: "variable_recurring",
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
