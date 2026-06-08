import { and, eq, isNull, sql } from "drizzle-orm";
import { db, financeMonthlyBriefs } from "@artifigenz/db";
import {
  computeAllTimeNumbers,
  computeAllTimeSignals,
  computeMonthNumbers,
  computeMonthSignals,
  latestTxnDateForScope,
  listAvailableMonths,
  type BriefNumbers,
  type BriefSignals,
} from "./compute";
import { generateHeadline } from "./narrative";

/**
 * Get-or-generate a brief for a single scope (a specific month or "all").
 *
 * Numbers are always recomputed from SQL (cheap). The headline lives in
 * the `finance_monthly_briefs` table; we regenerate only when the latest
 * txn date for this scope has moved past whatever was recorded when the
 * row was last written.
 *
 * Returns the headline + numbers + signals so the caller has everything
 * needed to render.
 */

export interface BriefView {
  scope: string; // "all" or "YYYY-MM-01"
  label: string;
  numbers: BriefNumbers;
  signals: BriefSignals;
  headline: string;
  signalsUsed: string[];
  generatedAt: string;
}

export async function getBrief(
  agentInstanceId: string,
  scope: string, // "all" or "YYYY-MM-01"
): Promise<BriefView> {
  const isAll = scope === "all";
  const monthValue = isAll ? null : scope;

  const numbers = isAll
    ? await computeAllTimeNumbers(agentInstanceId)
    : await computeMonthNumbers(agentInstanceId, scope);
  const signals = isAll
    ? await computeAllTimeSignals(numbers)
    : await computeMonthSignals(agentInstanceId, scope, numbers);

  const latestTxn = await latestTxnDateForScope(agentInstanceId, monthValue);

  // Check existing cache row.
  const existing = await db
    .select()
    .from(financeMonthlyBriefs)
    .where(
      and(
        eq(financeMonthlyBriefs.agentInstanceId, agentInstanceId),
        isAll
          ? isNull(financeMonthlyBriefs.month)
          : eq(financeMonthlyBriefs.month, scope),
      ),
    )
    .limit(1);

  const cached = existing[0];
  const cacheStillValid =
    cached &&
    cached.lastTxnDateAtGeneration === latestTxn &&
    typeof cached.headline === "string" &&
    cached.headline.length > 0;

  if (cacheStillValid) {
    return {
      scope,
      label: numbers.label,
      numbers,
      signals,
      headline: cached.headline,
      signalsUsed: ((cached.signals as { used?: string[] }).used ?? []),
      generatedAt: cached.generatedAt.toISOString(),
    };
  }

  // Generate fresh headline.
  const narrative = await generateHeadline(numbers, signals);

  // Manual upsert. ON CONFLICT can't target a partial unique index, so
  // we update if the row existed in the read above, otherwise insert.
  if (cached) {
    await db
      .update(financeMonthlyBriefs)
      .set({
        headline: narrative.headline,
        signals: { ranked: signals.ranked, used: narrative.signalsUsed },
        confidence: narrative.confidence.toFixed(2),
        lastTxnDateAtGeneration: latestTxn,
        generatedAt: new Date(),
      })
      .where(
        and(
          eq(financeMonthlyBriefs.agentInstanceId, agentInstanceId),
          isAll
            ? isNull(financeMonthlyBriefs.month)
            : eq(financeMonthlyBriefs.month, scope),
        ),
      );
  } else {
    await db.insert(financeMonthlyBriefs).values({
      agentInstanceId,
      month: monthValue,
      headline: narrative.headline,
      signals: { ranked: signals.ranked, used: narrative.signalsUsed },
      confidence: narrative.confidence.toFixed(2),
      lastTxnDateAtGeneration: latestTxn,
    });
  }

  return {
    scope,
    label: numbers.label,
    numbers,
    signals,
    headline: narrative.headline,
    signalsUsed: narrative.signalsUsed,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Available scopes for this instance, kind-tagged so the UI can lay them
 * out as three primary pills (All / Current / Previous) plus a dropdown
 * for older completed months. Newest first within each group.
 *
 *   - `all`      → averaged across all months
 *   - `current`  → calendar-current month (month-to-date, partial)
 *   - `previous` → most recent completed month
 *   - `older`    → every completed month before that
 */
export type ScopeKind = "all" | "current" | "previous" | "older";

export async function listBriefScopes(
  agentInstanceId: string,
): Promise<{
  scopes: Array<{ scope: string; label: string; kind: ScopeKind }>;
}> {
  const months = await listAvailableMonths(agentInstanceId);

  const today = new Date();
  const currentMonth = `${today.getUTCFullYear()}-${String(
    today.getUTCMonth() + 1,
  ).padStart(2, "0")}-01`;

  const scopes: Array<{ scope: string; label: string; kind: ScopeKind }> = [
    { scope: "all", label: "All", kind: "all" },
  ];

  const hasCurrent = months.includes(currentMonth);
  if (hasCurrent) {
    scopes.push({
      scope: currentMonth,
      label: "Current month",
      kind: "current",
    });
  }

  const completedMonths = months.filter((m) => m !== currentMonth);
  if (completedMonths[0]) {
    scopes.push({
      scope: completedMonths[0],
      label: "Previous month",
      kind: "previous",
    });
  }
  for (const m of completedMonths.slice(1)) {
    scopes.push({ scope: m, label: monthLabel(m), kind: "older" });
  }

  return { scopes };
}

function monthLabel(month: string): string {
  return new Date(month + "T00:00:00Z").toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
