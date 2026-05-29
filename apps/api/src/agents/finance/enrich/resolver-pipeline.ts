import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  financeTransactions,
  merchantBrands,
} from "@artifigenz/db";
import {
  resolveBrand,
  type BrandResolution,
  type PlaidHint,
} from "./llm-resolver";
import { buildLogoDevUrl } from "./logo-dev";

/**
 * Hybrid enrichment pipeline.
 *
 * For each merchant_normalized the agent has seen but we haven't enriched
 * yet:
 *   1. Gather any Plaid raw_data hints (free, just read from existing rows)
 *   2. Call the LLM brand resolver — Plaid hint passed as context
 *   3. Build a Logo.dev URL from the resolved website
 *   4. Write to merchant_brands (cache, shared across all users)
 *
 * Cross-user benefit: merchant_brands is keyed by merchant_normalized but
 * isn't user-scoped. So if user A enriched "amzn mktp" yesterday, user B
 * who ingests "amzn mktp" today gets it free from the table.
 *
 * Concurrency: 4 in parallel. Sonnet 4.6 + web search is rate-limited per
 * minute, and resolution averages ~3-6s/merchant; CONC=4 keeps us comfortably
 * under any tier's limit.
 */

const CONCURRENCY = 4;

export interface ResolveStats {
  candidatesFound: number;
  brandsResolved: number;
  brandsSkipped: number;
  errors: Array<{ merchant: string; error: string }>;
}

export async function resolveMissingBrands(
  agentInstanceId: string,
): Promise<ResolveStats> {
  // Find merchant_normalized values this agent has txns for, but which
  // aren't already in merchant_brands. LEFT JOIN + NULL filter is the
  // standard "anti-join" pattern.
  const missing = await db
    .selectDistinct({
      merchantNormalized: financeTransactions.merchantNormalized,
    })
    .from(financeTransactions)
    .leftJoin(
      merchantBrands,
      eq(financeTransactions.merchantNormalized, merchantBrands.merchantNormalized),
    )
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        isNotNull(financeTransactions.merchantNormalized),
        isNull(merchantBrands.merchantNormalized),
      ),
    );

  if (missing.length === 0) {
    return {
      candidatesFound: 0,
      brandsResolved: 0,
      brandsSkipped: 0,
      errors: [],
    };
  }

  // Pull Plaid hints for these merchants in one query — the "best" Plaid
  // raw_data per merchant (most populated brand fields). Anything from
  // statement uploads has no Plaid hint (correctly null).
  const plaidHints = await loadPlaidHints(
    agentInstanceId,
    missing
      .map((m) => m.merchantNormalized)
      .filter((s): s is string => !!s),
  );

  const errors: ResolveStats["errors"] = [];
  let resolved = 0;
  let skipped = 0;

  // Bounded-parallel resolution. Each task does one LLM call + one DB upsert.
  const queue = missing.filter(
    (m): m is { merchantNormalized: string } => !!m.merchantNormalized,
  );
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= queue.length) return;
      const merchantNormalized = queue[myIdx].merchantNormalized;
      try {
        const hint = plaidHints.get(merchantNormalized) ?? null;
        const result = await resolveBrand(merchantNormalized, hint);
        await upsertBrand(merchantNormalized, hint, result);
        resolved++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ merchant: merchantNormalized, error: msg });
        console.error(
          `[resolver] failed for "${merchantNormalized}":`,
          msg,
        );
      }
    }
  });
  await Promise.all(workers);

  return {
    candidatesFound: missing.length,
    brandsResolved: resolved,
    brandsSkipped: skipped,
    errors,
  };
}

interface PlaidRawData {
  merchant_name?: string | null;
  logo_url?: string | null;
  website?: string | null;
  merchant_entity_id?: string | null;
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
  } | null;
}

async function loadPlaidHints(
  agentInstanceId: string,
  merchantNormalizedKeys: string[],
): Promise<Map<string, PlaidHint>> {
  if (merchantNormalizedKeys.length === 0) return new Map();

  const rows = await db
    .select({
      merchantNormalized: financeTransactions.merchantNormalized,
      rawData: financeTransactions.rawData,
    })
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        eq(financeTransactions.source, "plaid"),
        isNotNull(financeTransactions.rawData),
        sql`${financeTransactions.merchantNormalized} = ANY(${sql.raw(
          `ARRAY[${merchantNormalizedKeys
            .map((k) => `'${k.replace(/'/g, "''")}'`)
            .join(",")}]::varchar[]`,
        )})`,
      ),
    );

  // Pick the most-populated raw_data per merchant.
  const best = new Map<string, { hint: PlaidHint; score: number }>();
  for (const r of rows) {
    if (!r.merchantNormalized) continue;
    const raw = (r.rawData ?? {}) as PlaidRawData;
    const pfc = raw.personal_finance_category;
    const hint: PlaidHint = {
      merchant_name: raw.merchant_name ?? null,
      logo_url: raw.logo_url ?? null,
      website: raw.website ?? null,
      merchant_entity_id: raw.merchant_entity_id ?? null,
      pfc_primary: pfc?.primary ?? null,
      pfc_detailed: pfc?.detailed ?? null,
    };
    const score =
      (hint.merchant_name ? 1 : 0) +
      (hint.logo_url ? 1 : 0) +
      (hint.website ? 1 : 0) +
      (hint.merchant_entity_id ? 2 : 0) +
      (hint.pfc_primary ? 1 : 0);
    if (score === 0) continue;
    const prev = best.get(r.merchantNormalized);
    if (!prev || score > prev.score) best.set(r.merchantNormalized, { hint, score });
  }

  return new Map(Array.from(best.entries()).map(([k, v]) => [k, v.hint]));
}

async function upsertBrand(
  merchantNormalized: string,
  hint: PlaidHint | null,
  resolution: BrandResolution,
): Promise<void> {
  // Logo.dev is the consistent logo source. If unconfigured, fall back to
  // Plaid's hosted logo (lower quality but better than nothing).
  const logoUrl =
    buildLogoDevUrl(resolution.website, { size: 128, format: "png" }) ??
    hint?.logo_url ??
    null;

  await db
    .insert(merchantBrands)
    .values({
      merchantNormalized,
      brandSlug: resolution.brandSlug,
      displayName: resolution.displayName,
      logoUrl,
      website: resolution.website,
      brandColor: null,
      industry: resolution.industry,
      source: resolution.usedPlaidHint ? "plaid" : "llm",
      confidence: resolution.confidence.toFixed(2),
      rawData: {
        llm_reasoning: resolution.reasoning,
        plaid_hint: hint
          ? {
              merchant_entity_id: hint.merchant_entity_id,
              pfc_primary: hint.pfc_primary,
              had_plaid_data: true,
            }
          : { had_plaid_data: false },
      },
      lastRefreshedAt: new Date(),
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: merchantBrands.merchantNormalized,
      set: {
        brandSlug: resolution.brandSlug,
        displayName: resolution.displayName,
        logoUrl,
        website: resolution.website,
        industry: resolution.industry,
        source: resolution.usedPlaidHint ? "plaid" : "llm",
        confidence: resolution.confidence.toFixed(2),
        lastRefreshedAt: new Date(),
      },
    });
}
