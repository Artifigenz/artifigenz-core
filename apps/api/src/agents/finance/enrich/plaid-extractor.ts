import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  db,
  financeTransactions,
  merchantBrands,
} from "@artifigenz/db";

/**
 * Pull merchant brand metadata from raw_data on Plaid transactions and
 * populate merchant_brands. Plaid gives us — for free — merchant_name (a
 * clean display name), logo_url, website, and personal_finance_category
 * for ~80% of US/CA merchants.
 *
 * Idempotent: only writes a row when no entry exists OR when the existing
 * row's source is itself 'plaid' (we don't overwrite higher-trust sources
 * like 'manual'). Picks the best Plaid row per merchant_normalized — the
 * one with the most populated fields.
 *
 * Designed to be cheap and frequent: runs after every ingest completes,
 * skips merchants we've already enriched from any non-plaid source.
 */

export interface PlaidExtractStats {
  candidatesScanned: number;
  brandsUpserted: number;
  brandsSkipped: number;
}

interface PlaidRawData {
  merchant_name?: string | null;
  logo_url?: string | null;
  website?: string | null;
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
    confidence_level?: string | null;
  } | null;
  // Plaid's stable merchant identifier — same string for every variant of
  // the merchant. We don't write to a column today but keep it in raw_data
  // so a future schema can dedupe across normalize variants.
  merchant_entity_id?: string | null;
}

/**
 * Extract brand metadata for one agent instance. Scans every Plaid txn,
 * groups by merchant_normalized, picks the best raw_data per group, and
 * upserts. Runs after every ingest completes; safe to call repeatedly.
 */
export async function extractPlaidBrands(
  agentInstanceId: string,
): Promise<PlaidExtractStats> {
  // Pull every Plaid txn for the agent that has a merchant_normalized and
  // a populated raw_data. Could be 1000s of rows but we project just the
  // columns we need, keeping memory bounded.
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
        isNotNull(financeTransactions.merchantNormalized),
        isNotNull(financeTransactions.rawData),
      ),
    );

  // Group by merchant_normalized, pick the most-populated raw_data per
  // merchant. "Most populated" = highest count of non-null brand fields.
  type Candidate = {
    merchantNormalized: string;
    raw: PlaidRawData;
    score: number;
  };
  const best = new Map<string, Candidate>();
  for (const r of rows) {
    if (!r.merchantNormalized) continue;
    const raw = (r.rawData ?? {}) as PlaidRawData;
    const score =
      (raw.merchant_name ? 1 : 0) +
      (raw.logo_url ? 2 : 0) +
      (raw.website ? 1 : 0) +
      (raw.personal_finance_category?.detailed ? 1 : 0);
    if (score === 0) continue;
    const prev = best.get(r.merchantNormalized);
    if (!prev || score > prev.score) {
      best.set(r.merchantNormalized, {
        merchantNormalized: r.merchantNormalized,
        raw,
        score,
      });
    }
  }

  if (best.size === 0) {
    return {
      candidatesScanned: rows.length,
      brandsUpserted: 0,
      brandsSkipped: 0,
    };
  }

  // For each candidate, look up the existing row (if any). We only write
  // when:
  //   • no existing row (first time we've seen this merchant), or
  //   • existing source is 'plaid' (we may have richer raw_data now)
  // We never overwrite source='brand_api' / 'llm' / 'manual'.
  const existingRows = await db
    .select({
      merchantNormalized: merchantBrands.merchantNormalized,
      source: merchantBrands.source,
    })
    .from(merchantBrands)
    .where(
      sql`${merchantBrands.merchantNormalized} = ANY(${sql.raw(
        `ARRAY[${Array.from(best.keys())
          .map((k) => `'${k.replace(/'/g, "''")}'`)
          .join(",")}]::varchar[]`,
      )})`,
    );
  const existingMap = new Map(
    existingRows.map((r) => [r.merchantNormalized, r.source]),
  );

  let upserted = 0;
  let skipped = 0;
  const now = new Date();

  for (const cand of best.values()) {
    const existingSource = existingMap.get(cand.merchantNormalized);
    if (existingSource && existingSource !== "plaid") {
      skipped++;
      continue;
    }
    const pfc = cand.raw.personal_finance_category;
    await db
      .insert(merchantBrands)
      .values({
        merchantNormalized: cand.merchantNormalized,
        displayName: cand.raw.merchant_name ?? null,
        logoUrl: cand.raw.logo_url ?? null,
        website: cand.raw.website ?? null,
        brandColor: null, // Plaid doesn't ship brand color
        industry: pfc?.primary ?? null,
        source: "plaid",
        confidence:
          pfc?.confidence_level === "VERY_HIGH"
            ? "0.95"
            : pfc?.confidence_level === "HIGH"
              ? "0.85"
              : pfc?.confidence_level === "MEDIUM"
                ? "0.70"
                : "0.50",
        rawData: {
          merchant_entity_id: cand.raw.merchant_entity_id ?? null,
          pfc_primary: pfc?.primary ?? null,
          pfc_detailed: pfc?.detailed ?? null,
          pfc_confidence: pfc?.confidence_level ?? null,
        },
        lastRefreshedAt: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: merchantBrands.merchantNormalized,
        set: {
          displayName: cand.raw.merchant_name ?? null,
          logoUrl: cand.raw.logo_url ?? null,
          website: cand.raw.website ?? null,
          industry: pfc?.primary ?? null,
          source: "plaid",
          lastRefreshedAt: now,
        },
        // Only update when the row was already 'plaid' — protects
        // higher-trust sources.
        setWhere: eq(merchantBrands.source, "plaid"),
      });
    upserted++;
  }

  return {
    candidatesScanned: rows.length,
    brandsUpserted: upserted,
    brandsSkipped: skipped,
  };
}
