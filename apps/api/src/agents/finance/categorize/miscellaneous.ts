import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  financeAccounts,
  financeTransactions,
  userBrandCategories,
} from "@artifigenz/db";
import { getClaudeClient } from "../lib/claude-client";

/**
 * Miscellaneous detection (Stage 2.3, final catch-all).
 *
 * Anything that survived all the typed detectors (subscription, fees,
 * loans, variable_recurring, etc.) lands here. The detector doesn't
 * decide whether something IS miscellaneous — it already is, by
 * exclusion. The detector's only job is to assign a discretionary
 * subtype per brand so the UI can break the bucket down meaningfully.
 *
 * Subtypes:
 *   dining, groceries, fuel, transport, shopping, entertainment, travel,
 *   personal_care, healthcare, gifts_donations, cash_atm, other_misc
 *
 * Architecture mirrors variable_recurring (per-merchant LLM, sample
 * descriptions, amount distribution). No stream-level tagging — at the
 * miscellaneous tier, individual amount streams within a merchant don't
 * map to distinct "products"; a coffee shop's amount distribution is
 * just different drinks, all dining. We tag the whole merchant.
 *
 * Runs last. No HAVING-count threshold — even single-charge brands get
 * subtyped so the user sees them in the right bucket.
 */

const LLM_CONCURRENCY = 4;
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

export interface MiscStats {
  candidatesFound: number;
  classified: number;
  cacheHits: number;
  llmErrors: Array<{ brandSlug: string; error: string }>;
  bySubtype: Record<string, number>;
}

export async function detectMiscellaneous(
  agentInstanceId: string,
): Promise<MiscStats> {
  const stats: MiscStats = {
    candidatesFound: 0,
    classified: 0,
    cacheHits: 0,
    llmErrors: [],
    bySubtype: {},
  };

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
      WHERE rn <= 3
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
      WHERE rn <= 4
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

  // If a prior detector already definitively bucketed the brand somewhere
  // else, skip — those rows are already tagged and the SQL above wouldn't
  // include them anyway. Cache hit replay: if our own previous run tagged
  // miscellaneous, reuse the subtype.
  const llmCandidates: Array<{
    brandSlug: string;
    displayName: string;
    merchants: MerchantProfile[];
  }> = [];

  for (const [brandSlug, bucket] of profiles) {
    const hit = cacheMap.get(brandSlug);
    if (hit?.category === "miscellaneous") {
      stats.cacheHits++;
      const applied = await applyMiscToMerchants(
        agentInstanceId,
        bucket.merchants.map((m) => m.merchantNormalized),
        hit.systemCategory,
        hit.confidence,
        hit.reasoning,
      );
      if (applied > 0) {
        stats.bySubtype[hit.systemCategory ?? "other_misc"] =
          (stats.bySubtype[hit.systemCategory ?? "other_misc"] ?? 0) + applied;
      }
    } else {
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

          await db
            .insert(userBrandCategories)
            .values({
              agentInstanceId,
              brandSlug: c.brandSlug,
              category: "miscellaneous",
              systemCategory: result.subtype,
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
                category: "miscellaneous",
                systemCategory: result.subtype,
                confidence: result.confidence.toFixed(2),
                source: "llm",
                reasoning: result.reasoning,
                updatedAt: new Date(),
              },
            });

          const applied = await applyMiscToMerchants(
            agentInstanceId,
            c.merchants.map((m) => m.merchantNormalized),
            result.subtype,
            result.confidence.toFixed(2),
            result.reasoning,
          );
          if (applied > 0) {
            stats.classified++;
            stats.bySubtype[result.subtype] =
              (stats.bySubtype[result.subtype] ?? 0) + applied;
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

const MISC_SUBTYPES = [
  "dining",
  "groceries",
  "fuel",
  "transport",
  "shopping",
  "entertainment",
  "travel",
  "personal_care",
  "healthcare",
  "gifts_donations",
  "cash_atm",
  "other_misc",
] as const;
type MiscSubtype = (typeof MISC_SUBTYPES)[number];

interface MiscClassification {
  subtype: MiscSubtype;
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a transaction classifier assigning a DISCRETIONARY SPEND SUBTYPE to a brand. Every brand reaching you has already been excluded from subscription, internal_transfer, income, fee/interest, loan EMI, and contracted variable-recurring bills — so the question is no longer "what kind of recurring obligation is this", just "what kind of discretionary spending category does this brand fall into".

You will be given:
- A brand (display_name + brand_slug)
- A list of merchants under this brand, each with sample descriptions, amount distribution, and cadence stats
- The user's connected accounts

Pick ONE subtype:

1. "dining" — Restaurants, cafes, coffee shops, bars, food delivery (DoorDash, Uber Eats, etc. when not the platform fee), bakeries, food trucks.

2. "groceries" — Supermarkets, grocery stores, specialty food markets, butcher / fish / produce shops, farmers' markets.

3. "fuel" — Gas stations, EV charging networks.

4. "transport" — Ride-share (Uber, Lyft, etc.), taxis, public transit single tickets, parking, tolls, car wash, vehicle maintenance.

5. "shopping" — Retail of any kind not covered above: clothing, electronics, home goods, hardware, books, online marketplaces (Amazon when used as a retailer), department stores, pharmacies (non-prescription), beauty / cosmetics retail.

6. "entertainment" — Movies, theaters, concerts, sporting events, theme parks, museums, gaming purchases, hobby supplies.

7. "travel" — Airlines, hotels, vacation rentals, rental cars, travel agencies, tour operators, cruise lines.

8. "personal_care" — Salon, barber, spa, gym day-pass (the visit, not the membership), beauty services.

9. "healthcare" — Doctor / clinic / dental / vision visits, prescription pharmacy charges, lab fees, therapy.

10. "gifts_donations" — Charity donations, gifts to friends / family, fundraisers.

11. "cash_atm" — ATM withdrawals, cash advances classified as cash (not loan).

12. "other_misc" — Truly doesn't fit any of the eleven above. Use sparingly.

DECISION GUIDANCE:
- The merchant's brand identity and sample descriptions are the strongest signals. Use both — and your own knowledge of what the brand sells.
- A brand that operates in MULTIPLE categories (Amazon sells everything; large supermarkets sell groceries + electronics + pharmacy) → pick the dominant pattern based on amount distribution and typical use. Default Amazon to "shopping" unless context suggests groceries.
- A delivery-platform charge (DoorDash, Uber Eats, Grubhub) is "dining" — the platform passes through to a restaurant.
- A ride-share platform (Uber for rides, Lyft) is "transport". When Uber and Uber Eats are the SAME merchant_normalized in the data (rare), default to dining if the average is low; transport if higher. Use sample descriptions to disambiguate.
- "other_misc" should be rare — most things fit one of the eleven.
- Reasoning: one short sentence referencing what tipped you to that subtype. Avoid generic boilerplate.

Reply with ONLY JSON, no markdown:
{
  "subtype": "dining" | "groceries" | "fuel" | "transport" | "shopping" | "entertainment" | "travel" | "personal_care" | "healthcare" | "gifts_donations" | "cash_atm" | "other_misc",
  "confidence": 0.0 to 1.0,
  "reasoning": "one short sentence"
}`;

async function classifyWithClaude(
  brandSlug: string,
  displayName: string,
  merchants: MerchantProfile[],
  accountContext: string,
): Promise<MiscClassification> {
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

Pick the discretionary spend subtype that best fits.`;

  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  const parsed = JSON.parse(extractJson(text)) as {
    subtype: string;
    confidence: number;
    reasoning: string;
  };

  const subtype = (MISC_SUBTYPES as readonly string[]).includes(parsed.subtype)
    ? (parsed.subtype as MiscSubtype)
    : "other_misc";

  return {
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

async function applyMiscToMerchants(
  agentInstanceId: string,
  merchantNormalizeds: string[],
  systemCategory: string | null,
  confidence: string | null,
  reasoning: string | null,
): Promise<number> {
  if (merchantNormalizeds.length === 0) return 0;
  const updated = await db
    .update(financeTransactions)
    .set({
      category: "miscellaneous",
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
        inArray(financeTransactions.merchantNormalized, merchantNormalizeds),
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
