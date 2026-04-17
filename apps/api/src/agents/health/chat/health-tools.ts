import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import {
  db,
  healthMetrics,
  healthDailySummaries,
  agentInstances,
} from "@artifigenz/db";
import type { ChatToolDefinition } from "../../../platform/chat/types";

async function getHealthAgent(userId: string) {
  const [agent] = await db
    .select()
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, userId),
        eq(agentInstances.agentTypeId, "health"),
      ),
    )
    .limit(1);
  return agent ?? null;
}

export const healthTools: ChatToolDefinition[] = [
  {
    name: "getSleepHistory",
    description:
      "Get the user's sleep data (duration in minutes) for a date range",
    input_schema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date YYYY-MM-DD" },
        endDate: { type: "string", description: "End date YYYY-MM-DD" },
        days: {
          type: "number",
          description: "Number of recent days (default 7, alternative to start/end)",
        },
      },
    },
    async execute(input, ctx) {
      const agent = await getHealthAgent(ctx.user.id);
      if (!agent) return { sleep: [], message: "Health agent not activated" };

      const { startDate, endDate } = resolveDateRange(input);

      const summaries = await db
        .select({
          date: healthDailySummaries.summaryDate,
          sleepMinutes: healthDailySummaries.sleepMinutes,
        })
        .from(healthDailySummaries)
        .where(
          and(
            eq(healthDailySummaries.agentInstanceId, agent.id),
            gte(healthDailySummaries.summaryDate, startDate),
            lte(healthDailySummaries.summaryDate, endDate),
          ),
        )
        .orderBy(desc(healthDailySummaries.summaryDate));

      const sleep = summaries
        .filter((s) => s.sleepMinutes !== null)
        .map((s) => ({
          date: s.date,
          sleepMinutes: s.sleepMinutes,
          sleepHours: s.sleepMinutes !== null ? +(s.sleepMinutes / 60).toFixed(1) : null,
        }));

      const avgMinutes =
        sleep.length > 0
          ? Math.round(
              sleep.reduce((s, v) => s + (v.sleepMinutes ?? 0), 0) / sleep.length,
            )
          : null;

      return {
        sleep,
        count: sleep.length,
        averageSleepMinutes: avgMinutes,
        averageSleepHours: avgMinutes !== null ? +(avgMinutes / 60).toFixed(1) : null,
      };
    },
  },

  {
    name: "getActivityHistory",
    description:
      "Get the user's daily activity data (steps, calories, distance, exercise minutes)",
    input_schema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date YYYY-MM-DD" },
        endDate: { type: "string", description: "End date YYYY-MM-DD" },
        days: { type: "number", description: "Number of recent days (default 7)" },
      },
    },
    async execute(input, ctx) {
      const agent = await getHealthAgent(ctx.user.id);
      if (!agent) return { activity: [], message: "Health agent not activated" };

      const { startDate, endDate } = resolveDateRange(input);

      const summaries = await db
        .select()
        .from(healthDailySummaries)
        .where(
          and(
            eq(healthDailySummaries.agentInstanceId, agent.id),
            gte(healthDailySummaries.summaryDate, startDate),
            lte(healthDailySummaries.summaryDate, endDate),
          ),
        )
        .orderBy(desc(healthDailySummaries.summaryDate));

      const activity = summaries.map((s) => ({
        date: s.summaryDate,
        steps: s.steps,
        activeCalories: s.activeCalories,
        exerciseMinutes: s.exerciseMinutes,
        distanceKm: s.distanceKm ? Number(s.distanceKm) : null,
        flightsClimbed: s.flightsClimbed,
      }));

      const stepsArr = summaries.map((s) => s.steps).filter((s): s is number => s != null);
      const avgSteps = stepsArr.length > 0
        ? Math.round(stepsArr.reduce((a, b) => a + b, 0) / stepsArr.length)
        : null;

      return {
        activity,
        count: activity.length,
        averageDailySteps: avgSteps,
        totalSteps: stepsArr.reduce((a, b) => a + b, 0),
      };
    },
  },

  {
    name: "getHeartRateHistory",
    description: "Get the user's resting heart rate trend over time",
    input_schema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date YYYY-MM-DD" },
        endDate: { type: "string", description: "End date YYYY-MM-DD" },
        days: {
          type: "number",
          description: "Number of recent days (default 14)",
        },
      },
    },
    async execute(input, ctx) {
      const agent = await getHealthAgent(ctx.user.id);
      if (!agent) return { heartRate: [], message: "Health agent not activated" };

      const days = (input.days as number) ?? 14;
      const { startDate, endDate } = resolveDateRange({ ...input, days });

      const summaries = await db
        .select({
          date: healthDailySummaries.summaryDate,
          restingHeartRate: healthDailySummaries.restingHeartRate,
        })
        .from(healthDailySummaries)
        .where(
          and(
            eq(healthDailySummaries.agentInstanceId, agent.id),
            gte(healthDailySummaries.summaryDate, startDate),
            lte(healthDailySummaries.summaryDate, endDate),
          ),
        )
        .orderBy(desc(healthDailySummaries.summaryDate));

      const heartRate = summaries
        .filter((s) => s.restingHeartRate !== null)
        .map((s) => ({
          date: s.date,
          restingBpm: Number(s.restingHeartRate),
        }));

      const bpmArr = heartRate.map((h) => h.restingBpm);
      const avgBpm = bpmArr.length > 0
        ? Math.round(bpmArr.reduce((a, b) => a + b, 0) / bpmArr.length)
        : null;

      return {
        heartRate,
        count: heartRate.length,
        averageRestingBpm: avgBpm,
        minBpm: bpmArr.length > 0 ? Math.min(...bpmArr) : null,
        maxBpm: bpmArr.length > 0 ? Math.max(...bpmArr) : null,
      };
    },
  },

  {
    name: "getWorkoutHistory",
    description: "Get the user's workout history",
    input_schema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date YYYY-MM-DD" },
        endDate: { type: "string", description: "End date YYYY-MM-DD" },
        days: {
          type: "number",
          description: "Number of recent days (default 30)",
        },
      },
    },
    async execute(input, ctx) {
      const agent = await getHealthAgent(ctx.user.id);
      if (!agent) return { workouts: [], message: "Health agent not activated" };

      const days = (input.days as number) ?? 30;
      const { startDate, endDate } = resolveDateRange({ ...input, days });

      const workouts = await db
        .select()
        .from(healthMetrics)
        .where(
          and(
            eq(healthMetrics.agentInstanceId, agent.id),
            eq(healthMetrics.metricType, "workout"),
            gte(healthMetrics.recordDate, startDate),
            lte(healthMetrics.recordDate, endDate),
          ),
        )
        .orderBy(desc(healthMetrics.recordDate));

      const mapped = workouts.map((w) => ({
        date: w.recordDate,
        durationMinutes: Number(w.value),
        type: (w.rawData as { workoutType?: string })?.workoutType ?? "unknown",
        source: w.source,
      }));

      // Count by type
      const byType: Record<string, number> = {};
      for (const w of mapped) {
        byType[w.type] = (byType[w.type] ?? 0) + 1;
      }

      return {
        workouts: mapped,
        totalCount: mapped.length,
        totalMinutes: mapped.reduce((s, w) => s + w.durationMinutes, 0),
        byType,
      };
    },
  },

  {
    name: "getHealthSummary",
    description:
      "Get a comprehensive health overview for a period (averages, totals, trends)",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["this_week", "last_week", "this_month", "last_30_days"],
          description: "Time period (default last_30_days)",
        },
      },
    },
    async execute(input, ctx) {
      const agent = await getHealthAgent(ctx.user.id);
      if (!agent) return { message: "Health agent not activated" };

      const period = (input.period as string) ?? "last_30_days";
      const now = new Date();
      let startDate: Date;
      let endDate: Date = now;

      if (period === "this_week") {
        const day = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - day);
      } else if (period === "last_week") {
        const day = now.getDay();
        endDate = new Date(now);
        endDate.setDate(now.getDate() - day - 1);
        startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - 6);
      } else if (period === "this_month") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
      }

      const startStr = startDate.toISOString().slice(0, 10);
      const endStr = endDate.toISOString().slice(0, 10);

      const summaries = await db
        .select()
        .from(healthDailySummaries)
        .where(
          and(
            eq(healthDailySummaries.agentInstanceId, agent.id),
            gte(healthDailySummaries.summaryDate, startStr),
            lte(healthDailySummaries.summaryDate, endStr),
          ),
        );

      const stepsArr = summaries.map((s) => s.steps).filter((v): v is number => v != null);
      const sleepArr = summaries.map((s) => s.sleepMinutes).filter((v): v is number => v != null);
      const hrArr = summaries
        .map((s) => (s.restingHeartRate ? Number(s.restingHeartRate) : null))
        .filter((v): v is number => v != null);
      const calArr = summaries.map((s) => s.activeCalories).filter((v): v is number => v != null);

      return {
        period,
        startDate: startStr,
        endDate: endStr,
        daysWithData: summaries.length,
        steps: {
          average: stepsArr.length > 0 ? Math.round(stepsArr.reduce((a, b) => a + b, 0) / stepsArr.length) : null,
          total: stepsArr.reduce((a, b) => a + b, 0),
          best: stepsArr.length > 0 ? Math.max(...stepsArr) : null,
        },
        sleep: {
          averageMinutes: sleepArr.length > 0 ? Math.round(sleepArr.reduce((a, b) => a + b, 0) / sleepArr.length) : null,
          averageHours: sleepArr.length > 0 ? +((sleepArr.reduce((a, b) => a + b, 0) / sleepArr.length) / 60).toFixed(1) : null,
          best: sleepArr.length > 0 ? Math.max(...sleepArr) : null,
          worst: sleepArr.length > 0 ? Math.min(...sleepArr) : null,
        },
        heartRate: {
          averageBpm: hrArr.length > 0 ? Math.round(hrArr.reduce((a, b) => a + b, 0) / hrArr.length) : null,
          lowest: hrArr.length > 0 ? Math.min(...hrArr) : null,
          highest: hrArr.length > 0 ? Math.max(...hrArr) : null,
        },
        calories: {
          averageDaily: calArr.length > 0 ? Math.round(calArr.reduce((a, b) => a + b, 0) / calArr.length) : null,
          total: calArr.reduce((a, b) => a + b, 0),
        },
        workouts: {
          total: summaries.reduce((s, d) => s + (d.workoutCount ?? 0), 0),
          types: [...new Set(summaries.flatMap((s) => s.workoutTypes ?? []))],
        },
      };
    },
  },

  {
    name: "getHealthTrends",
    description:
      "Compare health metrics between two periods (e.g., this week vs last week)",
    input_schema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["steps", "sleep", "heart_rate", "calories", "all"],
          description: "Which metric to compare (default 'all')",
        },
        periodDays: {
          type: "number",
          description: "Length of each comparison period in days (default 7)",
        },
      },
    },
    async execute(input, ctx) {
      const agent = await getHealthAgent(ctx.user.id);
      if (!agent) return { message: "Health agent not activated" };

      const periodDays = (input.periodDays as number) ?? 7;
      const now = new Date();

      const currentEnd = now.toISOString().slice(0, 10);
      const currentStart = new Date(now);
      currentStart.setDate(now.getDate() - periodDays);
      const currentStartStr = currentStart.toISOString().slice(0, 10);

      const prevEnd = new Date(currentStart);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevEndStr = prevEnd.toISOString().slice(0, 10);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevEnd.getDate() - periodDays + 1);
      const prevStartStr = prevStart.toISOString().slice(0, 10);

      const [current, previous] = await Promise.all([
        db
          .select()
          .from(healthDailySummaries)
          .where(
            and(
              eq(healthDailySummaries.agentInstanceId, agent.id),
              gte(healthDailySummaries.summaryDate, currentStartStr),
              lte(healthDailySummaries.summaryDate, currentEnd),
            ),
          ),
        db
          .select()
          .from(healthDailySummaries)
          .where(
            and(
              eq(healthDailySummaries.agentInstanceId, agent.id),
              gte(healthDailySummaries.summaryDate, prevStartStr),
              lte(healthDailySummaries.summaryDate, prevEndStr),
            ),
          ),
      ]);

      function calcTrend(
        curr: (number | null)[],
        prev: (number | null)[],
      ) {
        const cValid = curr.filter((v): v is number => v != null);
        const pValid = prev.filter((v): v is number => v != null);
        const cAvg = cValid.length > 0 ? cValid.reduce((a, b) => a + b, 0) / cValid.length : null;
        const pAvg = pValid.length > 0 ? pValid.reduce((a, b) => a + b, 0) / pValid.length : null;
        const pctChange =
          cAvg !== null && pAvg !== null && pAvg !== 0
            ? Math.round(((cAvg - pAvg) / pAvg) * 100)
            : null;
        return {
          current: cAvg !== null ? Math.round(cAvg) : null,
          previous: pAvg !== null ? Math.round(pAvg) : null,
          change: pctChange,
          direction: pctChange !== null ? (pctChange > 0 ? "up" : pctChange < 0 ? "down" : "flat") : null,
        };
      }

      return {
        periodDays,
        currentPeriod: { start: currentStartStr, end: currentEnd },
        previousPeriod: { start: prevStartStr, end: prevEndStr },
        steps: calcTrend(
          current.map((s) => s.steps),
          previous.map((s) => s.steps),
        ),
        sleepMinutes: calcTrend(
          current.map((s) => s.sleepMinutes),
          previous.map((s) => s.sleepMinutes),
        ),
        restingHeartRate: calcTrend(
          current.map((s) => (s.restingHeartRate ? Number(s.restingHeartRate) : null)),
          previous.map((s) => (s.restingHeartRate ? Number(s.restingHeartRate) : null)),
        ),
        activeCalories: calcTrend(
          current.map((s) => s.activeCalories),
          previous.map((s) => s.activeCalories),
        ),
      };
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────

function resolveDateRange(input: Record<string, unknown>): {
  startDate: string;
  endDate: string;
} {
  if (input.startDate && input.endDate) {
    return {
      startDate: input.startDate as string,
      endDate: input.endDate as string,
    };
  }

  const days = (input.days as number) ?? 7;
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
  };
}
