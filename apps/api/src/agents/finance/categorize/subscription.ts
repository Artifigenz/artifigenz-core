import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  financeAccounts,
  financeTransactions,
  userBrandCategories,
} from "@artifigenz/db";
import { getClaudeClient } from "../lib/claude-client";

/**
 * Subscription detection (Stage 2.3, third slice).
 *
 * A "subscription" here means a recurring fixed-fee charge to a service
 * brand — the canonical product use case ("Netflix charges tomorrow",
 * "Adobe just raised the price"). We classify per brand and emit one
 * of seven subtypes:
 *   streaming, software_saas, membership, news_media, cloud_storage,
 *   entertainment, other_subscription
 *
 * Architecture mirrors detectIncome / detectInternalTransfers: per-brand
 * processing, LLM-driven decisions (the deterministic stats are fed as
 * context, not used as independent decision criteria), cache results
 * in user_brand_categories. Only touches txns where category IS NULL.
 *
 * Pre-condition: internal_transfer + income already ran, so brands
 * already claimed by those detectors are skipped here.
 *
 * No trial-to-paid heuristic, no canceled-subscription inference. The
 * classifier just looks at whatever's in the data and decides whether
 * the historical pattern is subscription-shaped. Surfacing "did you
 * cancel?" or "Netflix charges tomorrow" is Subscription Radar's job
 * downstream (Stage 4) — that's where lastSeenDate + cadence are read.
 */

const LLM_CONCURRENCY = 4;
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

export interface SubscriptionStats {
  candidatesFound: number;
  classifiedAsSubscription: number;
  classifiedAsNotSubscription: number;
  cacheHits: number;
  llmErrors: Array<{ brandSlug: string; error: string }>;
  bySubtype: Record<string, number>;
}

export async function detectSubscriptions(
  agentInstanceId: string,
): Promise<SubscriptionStats> {
  const stats: SubscriptionStats = {
    candidatesFound: 0,
    classifiedAsSubscription: 0,
    classifiedAsNotSubscription: 0,
    cacheHits: 0,
    llmErrors: [],
    bySubtype: {},
  };

  // Gather outflow brand profiles. Only brands the user has UNCATEGORIZED
  // outflow transactions for. Single SQL pass — amount + date stats
  // computed in the DB.
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
      AND ft.direction = 'out'  -- outflows only (Plaid convention)
      AND mb.brand_slug IS NOT NULL
    GROUP BY mb.brand_slug, mb.display_name
    ORDER BY txn_count DESC
  `);

  stats.candidatesFound = profiles.length;
  if (profiles.length === 0) return stats;

  // Account context for the LLM (helps it distinguish credit-card-paid
  // streaming subs from utility-bill payments, etc.).
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

  // Load existing cache for all candidates.
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

  // Categories other detectors own — skip without re-evaluation.
  const DEFINITIVE_NOT_SUBSCRIPTION = new Set([
    "internal_transfer",
    "income",
    "loan_emi",
    "fee_interest",
    "variable_recurring",
    "miscellaneous",
  ]);

  for (const p of profiles) {
    const hit = cacheMap.get(p.brand_slug);
    if (!hit) continue;
    if (hit.category === "subscription") {
      stats.cacheHits++;
      const applied = await applySubscriptionToBrand(
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
    } else if (DEFINITIVE_NOT_SUBSCRIPTION.has(hit.category)) {
      stats.cacheHits++;
    }
    // "other" or unknown → fall through to LLM (subscription hasn't seen).
  }

  // What's left for LLM.
  const uncached = profiles.filter((p) => {
    const hit = cacheMap.get(p.brand_slug);
    if (!hit) return true;
    if (hit.category === "subscription") return false;
    if (DEFINITIVE_NOT_SUBSCRIPTION.has(hit.category)) return false;
    return true;
  });
  if (uncached.length === 0) return stats;

  // Bounded-parallel classification.
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
              category: result.isSubscription ? "subscription" : "other",
              systemCategory: result.isSubscription ? result.subtype : null,
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
                category: result.isSubscription ? "subscription" : "other",
                systemCategory: result.isSubscription ? result.subtype : null,
                confidence: result.confidence.toFixed(2),
                source: "llm",
                reasoning: result.reasoning,
                updatedAt: new Date(),
              },
            });

          if (result.isSubscription) {
            const applied = await applySubscriptionToBrand(
              agentInstanceId,
              p.brand_slug,
              result.subtype,
              result.confidence.toFixed(2),
              result.reasoning,
            );
            if (applied > 0) {
              stats.classifiedAsSubscription++;
              stats.bySubtype[result.subtype] =
                (stats.bySubtype[result.subtype] ?? 0) + applied;
            }
          } else {
            stats.classifiedAsNotSubscription++;
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

interface BrandOutflowProfile {
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
}): BrandOutflowProfile {
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

const SUBSCRIPTION_SUBTYPES = [
  "streaming",
  "software_saas",
  "membership",
  "news_media",
  "cloud_storage",
  "entertainment",
  "other_subscription",
] as const;
type SubscriptionSubtype = (typeof SUBSCRIPTION_SUBTYPES)[number];

interface SubscriptionClassification {
  isSubscription: boolean;
  subtype: SubscriptionSubtype | "other";
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a transaction classifier deciding whether a merchant's OUTFLOWS from a user's account represent a SUBSCRIPTION — a recurring fixed-fee charge to a service brand.

You will be given:
- Merchant identifier (display name + brand_slug)
- Outflow stats: count, total + average amount, amount variance % (std dev / mean), date range, average gap between charges, cadence hint
- The user's connected accounts (institutions + last4s)

Classify into ONE of these subtypes (set is_subscription=true for any of the 7 subtypes; false for "other"):

1. "streaming" — Netflix, Spotify, Disney+, YouTube Premium, Apple Music,
   Hulu, HBO Max, Paramount+, Crunchyroll, Audible, Tidal, Deezer, etc.

2. "software_saas" — Adobe, Notion, GitHub, Slack, Figma, Linear, Vercel,
   Cursor, Postman, JetBrains, Microsoft 365 (consumer), Zoom Pro,
   ChatGPT Plus, Claude Pro, Linear, Loom, etc.

3. "membership" — Amazon Prime, Costco, Sam's Club, AAA, gym memberships
   (Equinox, Crunch, Planet Fitness), club memberships.

4. "news_media" — NYT, WSJ, Washington Post, The Athletic, Substack
   newsletters (any individual sub), Medium, The Information.

5. "cloud_storage" — iCloud+, Google One, Dropbox, OneDrive personal,
   Backblaze, pCloud.

6. "entertainment" — Kindle Unlimited, Xbox Game Pass, PlayStation Plus,
   Nintendo Switch Online, Twitch subs, Patreon (individual creators).

7. "other_subscription" — clearly a subscription (recurring fixed amount,
   regular cadence, 3+ occurrences, brand offers a paid service) but
   doesn't fit the six above (e.g., a SaaS that doesn't fit, a
   regional service we don't have a category for).

8. "other" (is_subscription=false) — NOT a subscription. Anything where
   any of the following is true:
     • Variable amount (variance > 15% — that's utility/usage-based, not
       subscription). Examples: utilities, phone, internet, AWS, Vercel
       usage tier, Uber, Lyft.
     • Recurring but to a non-service merchant: grocery store, gas
       station, restaurant chain, Amazon shopping.
     • One-off purchase: a single charge, no cadence.
     • Loan / EMI payment.
     • Bank fee / interest.

DECISION RULES:
- A true subscription has amount variance < 15% AND ≥ 3 occurrences AND
  the merchant offers a recurring paid service.
- Annual subscriptions (Adobe Photography, Amazon Prime annual) have
  cadence="annual" or "one-off" — they're still subscriptions even with
  just 1-2 occurrences IF the brand is a known annual-billing service.
  Be flexible on occurrence count for known annual subs.
- If variance is > 30%, almost certainly NOT a subscription — it's
  usage-based or variable spending.
- If brand is a known service but amount jumped mid-period (e.g., Adobe
  $19.99 → $22.99 — a price hike), still classify as subscription. Note
  the price change in your reasoning.

GUIDANCE:
- Trust brand identity. If display_name is "Netflix", it's a streaming
  subscription regardless of other signals.
- Don't classify utilities as subscriptions even if cadence is monthly
  — variance will betray them and the brand won't match the seven
  subtype lists.
- Reasoning should be specific to the brand and the actual signals you
  used. Avoid generic boilerplate.

Reply with ONLY JSON, no markdown:
{
  "is_subscription": boolean,
  "subtype": "streaming" | "software_saas" | "membership" | "news_media" | "cloud_storage" | "entertainment" | "other_subscription" | "other",
  "confidence": 0.0 to 1.0,
  "reasoning": "one short sentence"
}`;

async function classifyWithClaude(
  profile: BrandOutflowProfile,
  accountContext: string,
): Promise<SubscriptionClassification> {
  const client = getClaudeClient();
  const userPrompt = `Merchant: "${profile.displayName}" (brand_slug: "${profile.brandSlug}")

Outflow profile:
- ${profile.txnCount} charges
- Total: ${profile.totalAmount.toFixed(2)}
- Average: ${profile.avgAmount.toFixed(2)}
- Min: ${profile.amountMin.toFixed(2)}  Max: ${profile.amountMax.toFixed(2)}
- Amount variance (std dev / mean): ${profile.amountStdDevPct}%
- First charge: ${profile.firstDate}  Last charge: ${profile.lastDate}
- Average gap between charges: ${profile.avgDayGap} days (cadence hint: ${profile.cadenceHint})

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
    is_subscription: boolean;
    subtype: string;
    confidence: number;
    reasoning: string;
  };

  const subtype =
    (SUBSCRIPTION_SUBTYPES as readonly string[]).includes(parsed.subtype)
      ? (parsed.subtype as SubscriptionSubtype)
      : "other";
  const isSubscription =
    parsed.is_subscription === true && subtype !== "other";

  return {
    isSubscription,
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

async function applySubscriptionToBrand(
  agentInstanceId: string,
  brandSlug: string,
  systemCategory: string | null,
  confidence: string | null,
  reasoning: string | null,
): Promise<number> {
  const updated = await db
    .update(financeTransactions)
    .set({
      category: "subscription",
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
