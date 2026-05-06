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
      id: "finance.subscriptions.visibility",
      name: "Subscription Overview",
      critical: false,
      deliveryChannels: ["in_app"],
    },
    {
      id: "finance.subscriptions.charge-reminder",
      name: "Charge Reminder",
      critical: true,
      deliveryChannels: ["in_app", "email", "whatsapp", "telegram"],
    },
    {
      id: "finance.subscriptions.price-change",
      name: "Price Change Detected",
      critical: true,
      deliveryChannels: ["in_app", "email"],
    },
    {
      id: "finance.subscriptions.new-detected",
      name: "New Subscription Detected",
      critical: false,
      deliveryChannels: ["in_app", "email"],
    },
    {
      id: "finance.subscriptions.duplicate",
      name: "Duplicate Subscription",
      critical: false,
      deliveryChannels: ["in_app", "email"],
    },
    {
      id: "finance.subscriptions.summary",
      name: "Subscription Summary",
      critical: false,
      deliveryChannels: ["in_app", "email"],
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

    // ─── JOB A: Visibility — total monthly cost ───────────────────
    const monthlyTotal = calculateMonthlyTotal(detected);
    const annualTotal = monthlyTotal * 12;

    insights.push({
      insightTypeId: "finance.subscriptions.visibility",
      title: `${detected.length} subscriptions — $${monthlyTotal.toFixed(2)}/mo`,
      description: `You have ${detected.length} recurring subscriptions costing $${monthlyTotal.toFixed(2)} per month ($${annualTotal.toFixed(2)}/yr).`,
      data: {
        count: detected.length,
        monthlyTotal,
        annualTotal,
        subscriptions: detected.map((s) => ({
          merchant: s.merchantName,
          amount: s.amount,
          frequency: s.frequency,
          account: s.accountName,
        })),
      },
      critical: false,
    });

    // ─── JOB B: Timing — upcoming charges ─────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    for (const sub of detected) {
      const daysUntil = daysBetween(today, sub.nextChargeDate);

      // Day-before reminder
      if (daysUntil === 1) {
        insights.push({
          insightTypeId: "finance.subscriptions.charge-reminder",
          title: `${sub.merchantName} charges $${sub.amount.toFixed(2)} tomorrow`,
          description: `Heads up — ${sub.merchantName} will charge your ${sub.accountName ?? "account"} $${sub.amount.toFixed(2)} tomorrow.`,
          data: {
            merchant: sub.merchantName,
            amount: sub.amount,
            chargeDate: sub.nextChargeDate,
            account: sub.accountName,
          },
          critical: true,
        });
      }
    }

    // Upcoming week digest
    const upcoming = detected.filter((s) => {
      const days = daysBetween(today, s.nextChargeDate);
      return days >= 0 && days <= 7;
    });
    if (upcoming.length > 0) {
      const weekTotal = upcoming.reduce((sum, s) => sum + s.amount, 0);
      insights.push({
        insightTypeId: "finance.subscriptions.charge-reminder",
        title: `${upcoming.length} charges coming this week — $${weekTotal.toFixed(2)}`,
        description: `${upcoming.length} subscriptions will charge in the next 7 days, totaling $${weekTotal.toFixed(2)}.`,
        data: {
          count: upcoming.length,
          total: weekTotal,
          charges: upcoming.map((s) => ({
            merchant: s.merchantName,
            amount: s.amount,
            date: s.nextChargeDate,
          })),
        },
        critical: false,
      });
    }

    // ─── JOB C: Change — new subs, price changes ─────────────────
    // On first run (no known subs), skip "new" insights — we're just cataloging.
    // Only show "new subscription" when it's truly new (appeared after initial catalog).
    const isFirstRun = Object.keys(knownSubs).length === 0;

    for (const sub of detected) {
      const key = `${sub.merchantName}::${sub.accountName ?? ""}`;
      const previous = knownSubs[key];

      if (!previous && !isFirstRun) {
        // Only show "new" if this isn't the first run AND it's a recent pattern.
        // Check if subscription started recently (within ~60 days based on transaction count)
        const isRecent = sub.transactionCount <= 3; // 3 monthly charges = ~90 days max
        if (isRecent) {
          insights.push({
            insightTypeId: "finance.subscriptions.new-detected",
            title: `New subscription detected: ${sub.merchantName}`,
            description: `We noticed a new recurring charge of $${sub.amount.toFixed(2)} ${sub.frequency} from ${sub.merchantName}.`,
            data: {
              merchant: sub.merchantName,
              amount: sub.amount,
              frequency: sub.frequency,
              account: sub.accountName,
            },
            critical: false,
          });
        }
      } else if (previous && Math.abs(previous.amount - sub.amount) > 0.01) {
        const delta = sub.amount - previous.amount;
        const direction = delta > 0 ? "increased" : "decreased";
        insights.push({
          insightTypeId: "finance.subscriptions.price-change",
          title: `${sub.merchantName} price ${direction} by $${Math.abs(delta).toFixed(2)}`,
          description: `${sub.merchantName} is now charging $${sub.amount.toFixed(2)} (was $${previous.amount.toFixed(2)}).`,
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

    // ─── JOB D: Cleanup — duplicates ──────────────────────────────
    const byMerchant = new Map<string, DetectedSubscription[]>();
    for (const sub of detected) {
      const existing = byMerchant.get(sub.merchantName) ?? [];
      existing.push(sub);
      byMerchant.set(sub.merchantName, existing);
    }

    for (const [merchant, subs] of byMerchant.entries()) {
      if (subs.length > 1) {
        const total = subs.reduce((sum, s) => sum + s.amount, 0);
        insights.push({
          insightTypeId: "finance.subscriptions.duplicate",
          title: `${merchant} charged ${subs.length} times across accounts`,
          description: `You're paying for ${merchant} on ${subs.length} different accounts, totaling $${total.toFixed(2)}. Consider consolidating.`,
          data: {
            merchant,
            count: subs.length,
            total,
            accounts: subs.map((s) => ({
              account: s.accountName,
              amount: s.amount,
            })),
          },
          critical: false,
        });
      }
    }

    // ─── JOB E: Insight — biggest subs ───────────────────────────
    if (detected.length >= 3) {
      const biggest = [...detected]
        .sort((a, b) => monthlyCost(b) - monthlyCost(a))
        .slice(0, 3);

      insights.push({
        insightTypeId: "finance.subscriptions.summary",
        title: `Your top 3 subscriptions: ${biggest.map((s) => s.merchantName).join(", ")}`,
        description: `Your biggest recurring costs are ${biggest.map((s) => `${s.merchantName} ($${monthlyCost(s).toFixed(2)}/mo)`).join(", ")}.`,
        data: {
          topSubscriptions: biggest.map((s) => ({
            merchant: s.merchantName,
            monthlyAmount: monthlyCost(s),
            frequency: s.frequency,
          })),
          monthlyTotal,
          annualTotal,
        },
        critical: false,
      });
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
    await ctx.updateFacts({
      subscription_count: detected.length,
      subscription_cost_monthly: monthlyTotal,
      subscription_cost_annual: annualTotal,
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
