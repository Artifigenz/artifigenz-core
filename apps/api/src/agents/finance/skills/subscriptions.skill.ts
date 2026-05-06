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
      id: "finance.subscriptions.welcome",
      name: "Subscription Overview",
      critical: false,
      deliveryChannels: ["in_app", "email"],
    },
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

    console.log(`[Subscriptions] Running for agent instance ${agentInstanceId}`);

    // ─── Load transactions ────────────────────────────────────────
    const txRows = await db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.agentInstanceId, agentInstanceId))
      .orderBy(desc(financeTransactions.transactionDate));

    console.log(`[Subscriptions] Found ${txRows.length} transactions`);

    if (txRows.length === 0) {
      console.log(`[Subscriptions] No transactions, returning empty`);
      return [];
    }

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

    console.log(`[Subscriptions] Detected ${detected.length} subscriptions:`, detected.map(d => d.merchantName));

    // ─── Load previous state ──────────────────────────────────────
    const state = (await ctx.getSkillState<SkillState>()) ?? {};
    const knownSubs = state.knownSubscriptions ?? {};
    const isFirstRun = Object.keys(knownSubs).length === 0;

    console.log(`[Subscriptions] isFirstRun=${isFirstRun}, knownSubs count=${Object.keys(knownSubs).length}`);

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

    // Calculate dates for first-run expanded windows
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    // ═══════════════════════════════════════════════════════════════
    // FIRST RUN ONLY: Welcome insights (A, B, C)
    // ═══════════════════════════════════════════════════════════════
    if (isFirstRun && detected.length > 0) {
      const monthlyTotal = calculateMonthlyTotal(detected);

      // (A) Welcome insight — subscription overview
      insights.push({
        insightTypeId: "finance.subscriptions.welcome",
        title: `Monitoring ${detected.length} subscriptions`,
        description: `We found $${monthlyTotal.toFixed(2)}/mo in recurring charges across your accounts.`,
        data: {
          count: detected.length,
          monthlyTotal,
          annualTotal: monthlyTotal * 12,
          subscriptions: detected.map((s) => ({
            merchant: s.merchantName,
            amount: s.amount,
            frequency: s.frequency,
          })),
        },
        critical: false,
      });

      // (B) Recently charged — last 7 days (first run only)
      for (const sub of detected) {
        if (sub.lastChargeDate >= sevenDaysAgoStr) {
          insights.push({
            insightTypeId: "finance.subscriptions.charged",
            title: `${sub.merchantName} charged $${sub.amount.toFixed(2)}`,
            description: `${sub.accountName ?? "Account"} · ${formatRelativeDate(sub.lastChargeDate)}`,
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

      // (C) Upcoming this week — next 7 days (first run only)
      for (const sub of detected) {
        const daysUntil = daysBetween(today, sub.nextChargeDate);
        if (daysUntil >= 0 && daysUntil <= 7) {
          const dayLabel = daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
          insights.push({
            insightTypeId: "finance.subscriptions.upcoming",
            title: `${sub.merchantName} will charge $${sub.amount.toFixed(2)} ${dayLabel}`,
            description: `${sub.accountName ?? "Account"} · auto-renew`,
            data: {
              merchant: sub.merchantName,
              amount: sub.amount,
              chargeDate: sub.nextChargeDate,
              daysUntil,
              account: sub.accountName,
            },
            critical: false,
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // NORMAL DAILY FLOW (after first run)
    // ═══════════════════════════════════════════════════════════════
    if (!isFirstRun) {
      // ─── JOB 1: Upcoming — charges happening TODAY only ──────────
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

      // ─── JOB 2: New — truly new subscriptions ────────────────────
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

      // ─── JOB 3: Price Change — amount differs from expected ──────
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

      // ─── JOB 4: Charged — yesterday/today at expected amount ─────
      for (const sub of detected) {
        const key = `${sub.merchantName}::${sub.accountName ?? ""}`;
        const previous = knownSubs[key];
        if (previous && (sub.lastChargeDate === today || sub.lastChargeDate === yesterdayStr)) {
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

    console.log(`[Subscriptions] Returning ${insights.length} insights:`, insights.map(i => i.insightTypeId));
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

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) {
    return "today";
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return "yesterday";
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}
