import { eq, desc, and, gte } from "drizzle-orm";
import {
  db,
  users,
  agentInstances,
  insights,
  financeSubscriptions,
  healthDailySummaries,
} from "@artifigenz/db";
import type { ChatPromptContext } from "./types";

/**
 * Loads the live context needed to build a system prompt for a user.
 */
export async function loadPromptContext(params: {
  userId: string;
  anchoredInsightId?: string | null;
}): Promise<ChatPromptContext> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);

  if (!user) throw new Error(`User ${params.userId} not found`);

  const activeAgents = await db
    .select()
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, params.userId),
        eq(agentInstances.status, "active"),
      ),
    );

  const recentInsights = await db
    .select()
    .from(insights)
    .where(eq(insights.userId, params.userId))
    .orderBy(desc(insights.createdAt))
    .limit(10);

  // Build finance snapshot if user has a finance agent
  let financeSnapshot: ChatPromptContext["financeSnapshot"] = null;
  const financeAgent = activeAgents.find((a) => a.agentTypeId === "finance");
  if (financeAgent) {
    const subs = await db
      .select()
      .from(financeSubscriptions)
      .where(
        and(
          eq(financeSubscriptions.agentInstanceId, financeAgent.id),
          eq(financeSubscriptions.status, "active"),
        ),
      );

    const monthlyTotal = subs.reduce((sum, s) => {
      const amt = Number(s.amount);
      switch (s.frequency) {
        case "weekly":
          return sum + amt * 4.33;
        case "monthly":
          return sum + amt;
        case "quarterly":
          return sum + amt / 3;
        case "annual":
          return sum + amt / 12;
        default:
          return sum;
      }
    }, 0);

    const today = new Date().toISOString().slice(0, 10);
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const weekStr = week.toISOString().slice(0, 10);
    const upcomingCharges = subs.filter(
      (s) =>
        s.nextChargeDate &&
        s.nextChargeDate >= today &&
        s.nextChargeDate <= weekStr,
    ).length;

    financeSnapshot = {
      subscriptionCount: subs.length,
      monthlyTotal: Math.round(monthlyTotal * 100) / 100,
      upcomingCharges,
    };
  }

  // Build health snapshot if user has a health agent
  let healthSnapshot: ChatPromptContext["healthSnapshot"] = null;
  const healthAgent = activeAgents.find((a) => a.agentTypeId === "health");
  if (healthAgent) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    const summaries = await db
      .select()
      .from(healthDailySummaries)
      .where(
        and(
          eq(healthDailySummaries.agentInstanceId, healthAgent.id),
          gte(healthDailySummaries.summaryDate, sevenDaysAgoStr),
        ),
      );

    if (summaries.length > 0) {
      const stepsArr = summaries.map((s) => s.steps).filter((v): v is number => v != null);
      const sleepArr = summaries.map((s) => s.sleepMinutes).filter((v): v is number => v != null);
      const hrArr = summaries
        .map((s) => (s.restingHeartRate ? Number(s.restingHeartRate) : null))
        .filter((v): v is number => v != null);

      healthSnapshot = {
        avgSteps: stepsArr.length > 0
          ? Math.round(stepsArr.reduce((a, b) => a + b, 0) / stepsArr.length)
          : null,
        avgSleepHours: sleepArr.length > 0
          ? +((sleepArr.reduce((a, b) => a + b, 0) / sleepArr.length) / 60).toFixed(1)
          : null,
        avgRestingHR: hrArr.length > 0
          ? Math.round(hrArr.reduce((a, b) => a + b, 0) / hrArr.length)
          : null,
        daysWithData: summaries.length,
      };
    }
  }

  // Load anchored insight if specified
  let anchoredInsight: ChatPromptContext["anchoredInsight"] = null;
  if (params.anchoredInsightId) {
    const [insight] = await db
      .select()
      .from(insights)
      .where(eq(insights.id, params.anchoredInsightId))
      .limit(1);
    anchoredInsight = insight ?? null;
  }

  return {
    user,
    activeAgents,
    recentInsights,
    financeSnapshot,
    healthSnapshot,
    anchoredInsight,
  };
}

/**
 * Assembles the 5-layer system prompt from live context.
 */
export function buildSystemPrompt(ctx: ChatPromptContext): string {
  const layers: string[] = [];

  // Layer 1: Identity
  layers.push(
    `You are Artifigenz — an AI assistant that knows the user personally through their connected agents. You can help with anything (questions, writing, code, analysis), but you have special depth in domains where the user has active agents. Be concise, direct, and helpful. Use markdown for formatting when appropriate.`,
  );

  // Layer 2: User profile
  const userLayer = `## User
- Name: ${ctx.user.name ?? "(not set)"}
- Email: ${ctx.user.email}
- Timezone: ${ctx.user.timezone ?? "UTC"}
- Currency: ${ctx.user.currency ?? "USD"}
- Locale: ${ctx.user.locale ?? "en-US"}`;
  layers.push(userLayer);

  // Layer 2.5: User custom instructions — highest priority, persists across
  // all conversations. Matches ChatGPT's Custom Instructions feature.
  if (ctx.user.chatCustomInstructions?.trim()) {
    layers.push(`## Custom Instructions\n${ctx.user.chatCustomInstructions.trim()}`);
  }

  // Layer 3: Active agents + goals
  if (ctx.activeAgents.length > 0) {
    const agentList = ctx.activeAgents
      .map((a) => `- ${a.agentTypeId}: ${a.goal ?? "(no goal set)"}`)
      .join("\n");
    layers.push(`## Active Agents\n${agentList}`);
  }

  // Layer 4: Recent insights (summarized)
  if (ctx.recentInsights.length > 0) {
    const insightList = ctx.recentInsights
      .slice(0, 5)
      .map((i) => `- ${i.title}${i.isCritical ? " [CRITICAL]" : ""}`)
      .join("\n");
    layers.push(`## Recent Insights\n${insightList}`);
  }

  // Layer 5: Finance snapshot
  if (ctx.financeSnapshot) {
    layers.push(
      `## Finance Snapshot
- ${ctx.financeSnapshot.subscriptionCount} active subscriptions
- $${ctx.financeSnapshot.monthlyTotal.toFixed(2)}/month recurring
- ${ctx.financeSnapshot.upcomingCharges} charges coming in the next 7 days`,
    );
  }

  // Layer 5b: Health snapshot
  if (ctx.healthSnapshot) {
    const parts: string[] = [];
    if (ctx.healthSnapshot.avgSteps !== null) {
      parts.push(`${ctx.healthSnapshot.avgSteps.toLocaleString()} avg daily steps`);
    }
    if (ctx.healthSnapshot.avgSleepHours !== null) {
      parts.push(`${ctx.healthSnapshot.avgSleepHours}h avg sleep`);
    }
    if (ctx.healthSnapshot.avgRestingHR !== null) {
      parts.push(`${ctx.healthSnapshot.avgRestingHR} bpm avg resting HR`);
    }
    layers.push(
      `## Health Snapshot (last 7 days)\n- ${parts.join("\n- ")}\n- ${ctx.healthSnapshot.daysWithData} days of data`,
    );
  }

  // Layer 6: Anchored insight (contextual mode)
  if (ctx.anchoredInsight) {
    const ai = ctx.anchoredInsight;
    layers.push(
      `## Anchored Insight
The user is asking about this specific insight:
- Title: ${ai.title}
- Description: ${ai.description ?? "(none)"}
- Data: ${JSON.stringify(ai.data)}
- Critical: ${ai.isCritical}`,
    );
  }

  // Tool usage guidance
  layers.push(
    `## Tool Usage
You have tools available to query the user's real data. Use them when the conversation calls for specific data — never guess. For example, if the user asks "which subscriptions charge this week?", call getUpcomingCharges. If they ask about spending, call getSpendingSummary or getTransactions. If they ask about sleep, steps, or heart rate, use the health tools (getSleepHistory, getActivityHistory, getHeartRateHistory, getWorkoutHistory, getHealthSummary, getHealthTrends).`,
  );

  return layers.join("\n\n");
}
