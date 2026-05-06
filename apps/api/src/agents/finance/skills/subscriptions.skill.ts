import { eq, desc } from "drizzle-orm";
import { db, financeTransactions, financeSubscriptions } from "@artifigenz/db";
import type { SkillDefinition, InsightOutput } from "../../../platform/registry/types";
import { detectRecurring, type DetectedSubscription } from "../lib/recurring-detection";
import { daysBetween } from "../lib/transaction-normalizer";

interface SkillState {
  lastRunAt?: string;
  knownSubscriptions?: Record<string, { amount: number; frequency: string }>;
}

export const subscriptionsSkill: SkillDefinition = {
  id: "finance.subscriptions",
  name: "Subscriptions",
  description:
    "Discovers, tracks, and analyzes recurring charges across all your accounts.",
  agentTypeId: "finance",

  triggers: {
    schedule: "0 8 * * *", // Daily at 8am
    events: ["data_source.synced"],
  },

  insightTypes: [
    {
      id: "finance.subscriptions.upcoming",
      name: "Upcoming Charge",
      critical: false,
      deliveryChannels: ["in_app"],
    },
    {
      id: "finance.subscriptions.new",
      name: "New Subscription",
      critical: false,
      deliveryChannels: ["in_app", "email"],
    },
    {
      id: "finance.subscriptions.price-change",
      name: "Price Change Detected",
      critical: true,
      deliveryChannels: ["in_app", "email"],
    },
    {
      id: "finance.subscriptions.charged",
      name: "Charged as Expected",
      critical: false,
      deliveryChannels: ["in_app"],
    },
  ],

  async analyze(ctx): Promise<InsightOutput[]> {
    const insights: InsightOutput[] = [];
    const agentInstanceId = ctx.agentInstance.id;

    // ─── Load transactions ────────────────────────────────────────
    const txRows = await db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.agentInstanceId, agentInstanceId))
      .orderBy(desc(financeTransactions.transactionDate));

    if (txRows.length === 0) return [];

    // ─── Run detection ────────────────────────────────────────────
    const detected = detectRecurring(
      txRows.map((r) => ({
        id: r.id,
        transactionDate: r.transactionDate,
        merchantName: r.merchantName,
        description: r.description,
        amount: Number(r.amount),
        accountName: r.accountName,
        category: r.category,
      })),
    );

    // ─── Load previous state ──────────────────────────────────────
    const state = (await ctx.getSkillState<SkillState>()) ?? {};
    const knownSubs = state.knownSubscriptions ?? {};
    const isFirstRun = Object.keys(knownSubs).length === 0;

    // ─── Upsert detected subscriptions into DB ────────────────────
    for (const sub of detected) {
      await db
        .insert(financeSubscriptions)
        .values({
          agentInstanceId,
          merchantName: sub.merchantName,
          amount: sub.amount.toString(),
          frequency: sub.frequency,
          lastChargeDate: sub.lastChargeDate,
          nextChargeDate: sub.nextChargeDate,
          accountName: sub.accountName,
          status: "active",
        })
        .onConflictDoNothing();
    }

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    // ─── JOB 1: Upcoming — charges happening TODAY ────────────────
    for (const sub of detected) {
      if (sub.nextChargeDate === today) {
        insights.push({
          insightTypeId: "finance.subscriptions.upcoming",
          title: `${sub.merchantName} will charge $${sub.amount.toFixed(2)} today`,
          description: `${sub.accountName ?? "Account"} · auto-renew`,
          data: {
            merchant: sub.merchantName,
            amount: sub.amount,
            chargeDate: today,
            account: sub.accountName,
          },
          critical: false,
        });
      }
    }

    // ─── JOB 2: New — truly new subscriptions ─────────────────────
    // Only after first run, and only if the pattern is recent (≤3 charges)
    if (!isFirstRun) {
      for (const sub of detected) {
        const key = `${sub.merchantName}::${sub.accountName ?? ""}`;
        const previous = knownSubs[key];
        if (!previous && sub.transactionCount <= 3) {
          insights.push({
            insightTypeId: "finance.subscriptions.new",
            title: `New subscription: ${sub.merchantName}`,
            description: `$${sub.amount.toFixed(2)}/${sub.frequency === "monthly" ? "mo" : sub.frequency === "weekly" ? "wk" : sub.frequency === "annual" ? "yr" : sub.frequency}`,
            data: {
              merchant: sub.merchantName,
              amount: sub.amount,
              frequency: sub.frequency,
              account: sub.accountName,
            },
            critical: false,
          });
        }
      }
    }

    // ─── JOB 3: Price Change — amount differs from expected ───────
    for (const sub of detected) {
      const key = `${sub.merchantName}::${sub.accountName ?? ""}`;
      const previous = knownSubs[key];
      if (previous && Math.abs(previous.amount - sub.amount) > 0.50) {
        const delta = sub.amount - previous.amount;
        const direction = delta > 0 ? "increased" : "decreased";
        insights.push({
          insightTypeId: "finance.subscriptions.price-change",
          title: `${sub.merchantName} ${direction} $${previous.amount.toFixed(2)} → $${sub.amount.toFixed(2)}`,
          description: delta > 0
            ? `Up $${Math.abs(delta).toFixed(2)} from your usual rate`
            : `Down $${Math.abs(delta).toFixed(2)} from your usual rate`,
          data: {
            merchant: sub.merchantName,
            oldAmount: previous.amount,
            newAmount: sub.amount,
            delta,
          },
          critical: true,
        });
      }
    }

    // ─── JOB 4: Charged — recent charge at expected amount ────────
    // Check if any subscription charged yesterday/today at expected amount
    for (const sub of detected) {
      const key = `${sub.merchantName}::${sub.accountName ?? ""}`;
      const previous = knownSubs[key];
      // Only show "charged" confirmation if we knew about this sub before
      // and the last charge was yesterday or today
      if (previous && (sub.lastChargeDate === today || sub.lastChargeDate === yesterdayStr)) {
        // Check if amount is roughly the same (within 5%)
        const amountMatch = Math.abs(previous.amount - sub.amount) / previous.amount < 0.05;
        if (amountMatch) {
          insights.push({
            insightTypeId: "finance.subscriptions.charged",
            title: `${sub.merchantName} charged $${sub.amount.toFixed(2)} — as expected`,
            description: `${sub.accountName ?? "Account"} · No change from last month`,
            data: {
              merchant: sub.merchantName,
              amount: sub.amount,
              chargeDate: sub.lastChargeDate,
              account: sub.accountName,
            },
            critical: false,
          });
        }
      }
    }

    // ─── Update skill state ───────────────────────────────────────
    const newKnownSubs: SkillState["knownSubscriptions"] = {};
    for (const sub of detected) {
      const key = `${sub.merchantName}::${sub.accountName ?? ""}`;
      newKnownSubs[key] = { amount: sub.amount, frequency: sub.frequency };
    }
    await ctx.setSkillState<SkillState>({
      lastRunAt: new Date().toISOString(),
      knownSubscriptions: newKnownSubs,
    });

    // ─── Update context facts (Layer A) ──────────────────────────
    const monthlyTotal = calculateMonthlyTotal(detected);
    await ctx.updateFacts({
      subscription_count: detected.length,
      subscription_cost_monthly: monthlyTotal,
      subscription_cost_annual: monthlyTotal * 12,
    });

    return insights;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────

function monthlyCost(sub: DetectedSubscription): number {
  switch (sub.frequency) {
    case "weekly":
      return sub.amount * 4.33;
    case "monthly":
      return sub.amount;
    case "quarterly":
      return sub.amount / 3;
    case "annual":
      return sub.amount / 12;
  }
}

function calculateMonthlyTotal(subs: DetectedSubscription[]): number {
  return subs.reduce((sum, s) => sum + monthlyCost(s), 0);
}
