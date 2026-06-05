import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  financeAccounts,
  financeTransactions,
  merchantBrands,
  userBrandCategories,
} from "@artifigenz/db";
import { getClaudeClient } from "../lib/claude-client";

/**
 * Internal transfer detection pipeline.
 *
 * Three layers, cheap-first:
 *   1. Pair matching (SQL, free) — find outflow + inflow on different
 *      user accounts with same |amount|, opposite signs, within ±3 days.
 *      Both rows get the same transfer_pair_id and category set.
 *   2. Account-self-reference (SQL, free) — find unmatched txns whose
 *      normalized_description contains a user's own account_last4.
 *   3. LLM classifier (Claude, cached per (agent, brand_slug)) — for the
 *      remaining ambiguous brands, ask Claude with full user context.
 *      Cache the answer so future ingests are free.
 *
 * The pipeline is idempotent — it only touches rows where
 * `category IS NULL`. Re-running picks up only new transactions.
 *
 * Source-agnostic by design: every signal works equally for Plaid-ingested
 * and statement-uploaded data. No regex patterns, no maintained merchant
 * lists, no Plaid PFC dependency.
 */

const PAIR_DATE_WINDOW_DAYS = 3;
const LLM_CONCURRENCY = 4;
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

export interface InternalTransferStats {
  pairMatched: number;
  selfReferenceMatched: number;
  llmClassified: number;
  cacheHits: number;
  llmErrors: Array<{ brandSlug: string; error: string }>;
}

export async function detectInternalTransfers(
  agentInstanceId: string,
): Promise<InternalTransferStats> {
  const stats: InternalTransferStats = {
    pairMatched: 0,
    selfReferenceMatched: 0,
    llmClassified: 0,
    cacheHits: 0,
    llmErrors: [],
  };

  // Layer 1: pair matching.
  stats.pairMatched = await matchPairs(agentInstanceId);

  // Layer 2: account-self-reference.
  stats.selfReferenceMatched = await matchAccountSelfReference(agentInstanceId);

  // Layer 3: LLM with per-user brand cache.
  const llmResult = await classifyRemainingBrands(agentInstanceId);
  stats.llmClassified = llmResult.classified;
  stats.cacheHits = llmResult.cacheHits;
  stats.llmErrors = llmResult.errors;

  return stats;
}

// ─── Layer 1: pair matching ──────────────────────────────────────

async function matchPairs(agentInstanceId: string): Promise<number> {
  // For each agent, run a single SQL pass to find pairs:
  //   • Same agent_instance_id
  //   • Different account_id
  //   • Same absolute amount (one positive, one negative)
  //   • Transaction dates within ±N days
  //   • Neither already paired (transfer_pair_id IS NULL)
  //   • Neither already categorised
  //
  // The query picks the "lower id" of each pair to avoid double-matching,
  // joins to itself, and generates one UUID per pair.
  const pairs = await db.execute<{
    out_id: string;
    in_id: string;
    out_account_id: string;
    in_account_id: string;
    amount: string;
    out_date: string;
    in_date: string;
  }>(sql`
    WITH candidates AS (
      SELECT id, account_id, amount, transaction_date, direction
      FROM finance_transactions
      WHERE agent_instance_id = ${agentInstanceId}
        AND transfer_pair_id IS NULL
        AND category IS NULL
        AND account_id IS NOT NULL
        AND direction IN ('in', 'out')
    )
    SELECT
      o.id  AS out_id,
      i.id  AS in_id,
      o.account_id AS out_account_id,
      i.account_id AS in_account_id,
      o.amount,
      o.transaction_date AS out_date,
      i.transaction_date AS in_date
    FROM candidates o
    INNER JOIN candidates i
      ON o.direction = 'out'
      AND i.direction = 'in'
      AND o.account_id <> i.account_id
      AND o.amount = -i.amount  -- exact absolute match
      AND ABS(o.transaction_date - i.transaction_date) <= ${PAIR_DATE_WINDOW_DAYS}
  `);

  if (pairs.length === 0) return 0;

  // De-dupe in case the same outflow could match multiple inflows: pick
  // the closest-date inflow for each outflow. Same for the reverse.
  type Row = (typeof pairs)[number];
  const bestForOutflow = new Map<string, Row>();
  for (const r of pairs) {
    const prev = bestForOutflow.get(r.out_id);
    if (!prev) {
      bestForOutflow.set(r.out_id, r);
      continue;
    }
    const prevGap = Math.abs(
      new Date(prev.in_date).getTime() - new Date(prev.out_date).getTime(),
    );
    const curGap = Math.abs(
      new Date(r.in_date).getTime() - new Date(r.out_date).getTime(),
    );
    if (curGap < prevGap) bestForOutflow.set(r.out_id, r);
  }

  // For each chosen pair, generate a UUID and update both rows.
  // Drizzle doesn't have a built-in transaction here but each pair is
  // independent — at-most-once semantics maintained by the
  // `transfer_pair_id IS NULL` guard in the UPDATE.
  let paired = 0;
  for (const r of bestForOutflow.values()) {
    const pairId = randomUuid();
    const reasoning = `Outflow on account ${shortId(r.out_account_id)} pairs with inflow on account ${shortId(r.in_account_id)} (same |${parseFloat(r.amount).toFixed(2)}|, ${dayGap(r.out_date, r.in_date)}d apart)`;
    const updated = await db
      .update(financeTransactions)
      .set({
        transferPairId: pairId,
        category: "internal_transfer",
        categorizationSource: "system",
        confidence: "0.95",
        reasoning,
      })
      .where(
        and(
          inArray(financeTransactions.id, [r.out_id, r.in_id]),
          isNull(financeTransactions.transferPairId),
          isNull(financeTransactions.category),
        ),
      )
      .returning({ id: financeTransactions.id });
    if (updated.length === 2) paired += 2;
  }
  return paired;
}

// ─── Layer 2: account-number self-reference ──────────────────────

async function matchAccountSelfReference(
  agentInstanceId: string,
): Promise<number> {
  // Load this agent's account last4 list. If they only have one account,
  // self-reference is meaningless (any transfer "to acct ####" would be
  // to a different account that we'd need to also be looking at).
  const accounts = await db
    .select({
      accountId: financeAccounts.id,
      last4: financeAccounts.accountLast4,
    })
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, agentInstanceId));

  const validLast4s = accounts
    .map((a) => a.last4)
    .filter((s): s is string => !!s && /^\d{3,4}$/.test(s));
  if (validLast4s.length === 0) return 0;

  // Build a regex pattern that matches any of the user's last4s as a
  // word-bounded numeric token in normalized_description. We do the
  // matching in SQL so it's a single round trip.
  // Pattern: \y is Postgres word boundary; alternation over the last4s.
  const alternation = validLast4s
    .map((s) => s.replace(/[^0-9]/g, ""))
    .join("|");
  const pattern = `\\y(${alternation})\\y`;

  const updated = await db
    .update(financeTransactions)
    .set({
      category: "internal_transfer",
      categorizationSource: "system",
      confidence: "0.85",
      reasoning: `Description references your own account number`,
    })
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        isNull(financeTransactions.category),
        isNull(financeTransactions.transferPairId),
        sql`${financeTransactions.normalizedDescription} ~ ${pattern}`,
      ),
    )
    .returning({ id: financeTransactions.id });

  return updated.length;
}

// ─── Layer 3: LLM brand classifier, cached per (agent, brand_slug) ──

interface ClassifyResult {
  classified: number;
  cacheHits: number;
  errors: Array<{ brandSlug: string; error: string }>;
}

async function classifyRemainingBrands(
  agentInstanceId: string,
): Promise<ClassifyResult> {
  const result: ClassifyResult = { classified: 0, cacheHits: 0, errors: [] };

  // Find brand_slugs the user has unclassified txns for. Single query.
  const candidates = await db.execute<{
    brand_slug: string;
    display_name: string;
    sample_count: number;
    avg_amount: string;
  }>(sql`
    SELECT
      mb.brand_slug,
      mb.display_name,
      COUNT(*)::int AS sample_count,
      AVG(ABS(ft.amount::numeric))::text AS avg_amount
    FROM finance_transactions ft
    INNER JOIN merchant_brands mb
      ON ft.merchant_normalized = mb.merchant_normalized
    WHERE ft.agent_instance_id = ${agentInstanceId}
      AND ft.category IS NULL
      AND mb.brand_slug IS NOT NULL
    GROUP BY mb.brand_slug, mb.display_name
    ORDER BY COUNT(*) DESC
  `);

  if (candidates.length === 0) return result;

  // Load this user's accounts as context for the LLM.
  const userAccounts = await db
    .select({
      institution: financeAccounts.institutionName,
      last4: financeAccounts.accountLast4,
      type: financeAccounts.type,
    })
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, agentInstanceId));

  const accountContext = userAccounts
    .map((a) => `${a.institution ?? "Unknown"} ${a.type ?? ""} ••${a.last4 ?? "?"}`.trim())
    .join(", ");

  // Check cache for all candidate brands in one query.
  const brandSlugs = candidates.map((c) => c.brand_slug);
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

  // Apply cache hits first.
  for (const candidate of candidates) {
    const hit = cacheMap.get(candidate.brand_slug);
    if (!hit) continue;
    const n = await applyClassificationToBrand(
      agentInstanceId,
      candidate.brand_slug,
      hit.category,
      hit.systemCategory,
      hit.confidence,
      hit.reasoning,
    );
    if (n > 0) result.cacheHits++;
  }

  // What's still unclassified after cache pass.
  const uncached = candidates.filter((c) => !cacheMap.has(c.brand_slug));
  if (uncached.length === 0) return result;

  // Bounded-parallel LLM classification + cache write + apply.
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(LLM_CONCURRENCY, uncached.length) },
    async () => {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= uncached.length) return;
        const cand = uncached[myIdx];
        try {
          const classification = await classifyWithClaude(
            cand.brand_slug,
            cand.display_name,
            parseFloat(cand.avg_amount),
            cand.sample_count,
            accountContext,
          );
          await db
            .insert(userBrandCategories)
            .values({
              agentInstanceId,
              brandSlug: cand.brand_slug,
              category: classification.category,
              systemCategory: classification.systemCategory,
              confidence: classification.confidence.toFixed(2),
              source: "llm",
              reasoning: classification.reasoning,
            })
            .onConflictDoUpdate({
              target: [
                userBrandCategories.agentInstanceId,
                userBrandCategories.brandSlug,
              ],
              set: {
                category: classification.category,
                systemCategory: classification.systemCategory,
                confidence: classification.confidence.toFixed(2),
                source: "llm",
                reasoning: classification.reasoning,
                updatedAt: new Date(),
              },
            });
          const applied = await applyClassificationToBrand(
            agentInstanceId,
            cand.brand_slug,
            classification.category,
            classification.systemCategory,
            classification.confidence.toFixed(2),
            classification.reasoning,
          );
          if (applied > 0) result.classified++;
        } catch (err) {
          result.errors.push({
            brandSlug: cand.brand_slug,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  );
  await Promise.all(workers);

  return result;
}

interface LlmClassification {
  category: "internal_transfer" | "other";
  systemCategory: string | null;
  confidence: number;
  reasoning: string;
}

async function classifyWithClaude(
  brandSlug: string,
  displayName: string,
  avgAmount: number,
  sampleCount: number,
  accountContext: string,
): Promise<LlmClassification> {
  const client = getClaudeClient();
  const systemPrompt = `You are a transaction classifier deciding whether a merchant string represents an INTERNAL TRANSFER between a user's own accounts, or something else (external payment, expense, income, etc.).

You will be given:
- The merchant identifier and display name
- Average absolute amount and the number of times it appears
- The list of accounts the user has connected

Decide:
- "internal_transfer" if the merchant string represents moving money between the user's own accounts. Strong signals: bank/card payment language to the user's own institutions, self-handle UPI identifiers like "@okhdfcbank" when the user has HDFC connected, "transfer between accounts", "credit card payment" when the user has both bank and card connected.
- "other" if the merchant represents anything else — paying a person, a third party, an expense, income, a refund, an investment platform, an ATM withdrawal.

Special system_category labels (apply ONLY when category="internal_transfer"):
- "credit_card_payment" — outflow paying the user's own credit-card statement
- null otherwise

Reply with ONLY JSON, no markdown:
{
  "category": "internal_transfer" | "other",
  "system_category": "credit_card_payment" | null,
  "confidence": 0.0 to 1.0,
  "reasoning": "one short sentence explaining the decision"
}`;

  const userPrompt = `Merchant: "${displayName}" (brand_slug: "${brandSlug}")
Average amount: ${avgAmount.toFixed(2)}
Occurrence count: ${sampleCount}
User's connected accounts: ${accountContext || "(none on file)"}

Classify.`;

  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  const jsonText = extractJson(text);
  const parsed = JSON.parse(jsonText) as {
    category: string;
    system_category: string | null;
    confidence: number;
    reasoning: string;
  };

  return {
    category: parsed.category === "internal_transfer" ? "internal_transfer" : "other",
    systemCategory: parsed.system_category ?? null,
    confidence:
      typeof parsed.confidence === "number" &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 1
        ? parsed.confidence
        : 0.6,
    reasoning: parsed.reasoning ?? "",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

async function applyClassificationToBrand(
  agentInstanceId: string,
  brandSlug: string,
  category: string,
  systemCategory: string | null,
  confidence: string | null,
  reasoning: string | null,
): Promise<number> {
  // Only write internal_transfer onto transactions. "other" stays
  // unclassified so a subsequent (broader) categorization pass can
  // assign the actual category later.
  if (category !== "internal_transfer") return 0;

  const updated = await db
    .update(financeTransactions)
    .set({
      category,
      systemCategory,
      categorizationSource: "ai",
      confidence,
      reasoning,
    })
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        isNull(financeTransactions.category),
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

function randomUuid(): string {
  // Built-in Node 22 crypto.randomUUID — avoid dragging in a dep.
  return crypto.randomUUID();
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function dayGap(a: string, b: string): number {
  return Math.abs(
    Math.round(
      (new Date(a).getTime() - new Date(b).getTime()) / (24 * 60 * 60 * 1000),
    ),
  );
}
