import { eq, desc, gte, and } from "drizzle-orm";
import { db, healthDailySummaries } from "@artifigenz/db";
import type {
  SkillDefinition,
  InsightOutput,
} from "../../../platform/registry/types";

interface SkillState {
  lastRunAt?: string;
  previousWeekAvg?: {
    steps: number | null;
    sleepMinutes: number | null;
    restingHR: number | null;
  };
  streaks?: {
    steps8k: number;
    sleep7h: number;
    exercise: number;
  };
}

export const wellnessSkill: SkillDefinition = {
  id: "health.wellness",
  name: "Daily Wellness",
  description:
    "Analyzes your sleep, activity, heart rate, and workouts to deliver daily health insights.",
  agentTypeId: "health",

  triggers: {
    schedule: "0 7 * * *", // Daily at 7am
    events: ["data_source.synced"],
  },

  insightTypes: [
    {
      id: "health.wellness.daily-briefing",
      name: "Daily Health Briefing",
      critical: false,
      deliveryChannels: ["in_app", "email"],
    },
    {
      id: "health.wellness.sleep-alert",
      name: "Sleep Alert",
      critical: true,
      deliveryChannels: ["in_app", "email", "whatsapp", "telegram"],
    },
    {
      id: "health.wellness.activity-streak",
      name: "Activity Streak",
      critical: false,
      deliveryChannels: ["in_app"],
    },
    {
      id: "health.wellness.trend",
      name: "Health Trend",
      critical: false,
      deliveryChannels: ["in_app", "email"],
    },
    {
      id: "health.wellness.anomaly",
      name: "Health Anomaly",
      critical: true,
      deliveryChannels: ["in_app", "email", "whatsapp"],
    },
    {
      id: "health.wellness.weekly-summary",
      name: "Weekly Summary",
      critical: false,
      deliveryChannels: ["in_app", "email"],
    },
  ],

  async analyze(ctx): Promise<InsightOutput[]> {
    const insights: InsightOutput[] = [];
    const agentInstanceId = ctx.agentInstance.id;

    // Load last 30 days of daily summaries
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);

    const summaries = await db
      .select()
      .from(healthDailySummaries)
      .where(
        and(
          eq(healthDailySummaries.agentInstanceId, agentInstanceId),
          gte(healthDailySummaries.summaryDate, thirtyDaysAgoStr),
        ),
      )
      .orderBy(desc(healthDailySummaries.summaryDate));

    if (summaries.length === 0) return [];

    const state = (await ctx.getSkillState<SkillState>()) ?? {};
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    // Get yesterday's summary (most recent complete day)
    const todaySummary = summaries.find((s) => s.summaryDate === yesterdayStr) ?? summaries[0];
    const last7 = summaries.slice(0, 7);
    const last14 = summaries.slice(0, 14);
    const prev7 = summaries.slice(7, 14);

    // ─── JOB A: Daily Briefing ───────────────────────────────────
    if (todaySummary) {
      const parts: string[] = [];
      if (todaySummary.sleepMinutes) {
        const h = Math.floor(todaySummary.sleepMinutes / 60);
        const m = todaySummary.sleepMinutes % 60;
        parts.push(`${h}h ${m}m sleep`);
      }
      if (todaySummary.steps) {
        parts.push(`${todaySummary.steps.toLocaleString()} steps`);
      }
      if (todaySummary.restingHeartRate) {
        parts.push(`${Number(todaySummary.restingHeartRate).toFixed(0)} bpm resting HR`);
      }
      if (todaySummary.activeCalories) {
        parts.push(`${todaySummary.activeCalories} active cal`);
      }
      if (todaySummary.workoutCount && todaySummary.workoutCount > 0) {
        parts.push(
          `${todaySummary.workoutCount} workout${todaySummary.workoutCount > 1 ? "s" : ""}`,
        );
      }

      if (parts.length > 0) {
        insights.push({
          insightTypeId: "health.wellness.daily-briefing",
          title: parts.join(" · "),
          description: `Here's your health snapshot for ${formatDate(todaySummary.summaryDate)}: ${parts.join(", ")}.`,
          data: {
            date: todaySummary.summaryDate,
            steps: todaySummary.steps,
            sleepMinutes: todaySummary.sleepMinutes,
            restingHeartRate: todaySummary.restingHeartRate
              ? Number(todaySummary.restingHeartRate)
              : null,
            activeCalories: todaySummary.activeCalories,
            exerciseMinutes: todaySummary.exerciseMinutes,
            workoutCount: todaySummary.workoutCount,
            distanceKm: todaySummary.distanceKm
              ? Number(todaySummary.distanceKm)
              : null,
          },
          critical: false,
        });
      }
    }

    // ─── JOB B: Sleep Alerts ─────────────────────────────────────
    const recentSleep = last7
      .filter((s) => s.sleepMinutes !== null)
      .map((s) => s.sleepMinutes!);

    if (recentSleep.length >= 3) {
      // Alert: 3+ consecutive nights below 6 hours
      let consecutiveLow = 0;
      for (const mins of recentSleep) {
        if (mins < 360) {
          consecutiveLow++;
        } else {
          break;
        }
      }

      if (consecutiveLow >= 3) {
        const avgSleep = recentSleep.slice(0, consecutiveLow);
        const avg = avgSleep.reduce((s, v) => s + v, 0) / avgSleep.length;
        const avgH = Math.floor(avg / 60);
        const avgM = Math.round(avg % 60);

        insights.push({
          insightTypeId: "health.wellness.sleep-alert",
          title: `Sleep below 6h for ${consecutiveLow} consecutive nights`,
          description: `You've averaged ${avgH}h ${avgM}m of sleep over the last ${consecutiveLow} nights. Consider adjusting your bedtime — chronic sleep debt affects recovery, focus, and mood.`,
          data: {
            consecutiveNights: consecutiveLow,
            averageMinutes: Math.round(avg),
            recentNights: avgSleep,
          },
          critical: true,
        });
      }
    }

    // ─── JOB C: Activity Streaks ─────────────────────────────────
    // Steps streak (8K+ days)
    let stepsStreak = 0;
    for (const s of summaries) {
      if (s.steps && s.steps >= 8000) {
        stepsStreak++;
      } else {
        break;
      }
    }

    if (stepsStreak >= 3) {
      const prevStreak = state.streaks?.steps8k ?? 0;
      // Only generate insight when streak hits new milestones (3, 5, 7, 10, 14, 21, 30)
      const milestones = [3, 5, 7, 10, 14, 21, 30];
      if (milestones.includes(stepsStreak) && stepsStreak > prevStreak) {
        insights.push({
          insightTypeId: "health.wellness.activity-streak",
          title: `${stepsStreak}-day step streak — 8K+ steps every day`,
          description: `You've hit 8,000+ steps for ${stepsStreak} days in a row. Keep it going!`,
          data: { streakDays: stepsStreak, threshold: 8000, metric: "steps" },
          critical: false,
        });
      }
    }

    // Sleep streak (7+ hours)
    let sleepStreak = 0;
    for (const s of summaries) {
      if (s.sleepMinutes && s.sleepMinutes >= 420) {
        sleepStreak++;
      } else {
        break;
      }
    }

    if (sleepStreak >= 3) {
      const prevStreak = state.streaks?.sleep7h ?? 0;
      const milestones = [3, 5, 7, 10, 14, 21, 30];
      if (milestones.includes(sleepStreak) && sleepStreak > prevStreak) {
        insights.push({
          insightTypeId: "health.wellness.activity-streak",
          title: `${sleepStreak}-night sleep streak — 7+ hours every night`,
          description: `You've slept 7+ hours for ${sleepStreak} consecutive nights. Your body thanks you.`,
          data: { streakDays: sleepStreak, threshold: 420, metric: "sleep" },
          critical: false,
        });
      }
    }

    // ─── JOB D: Trends (compare this week vs last week) ──────────
    if (last7.length >= 5 && prev7.length >= 5) {
      const thisWeekSteps = avg(last7.map((s) => s.steps));
      const prevWeekSteps = avg(prev7.map((s) => s.steps));
      const thisWeekSleep = avg(last7.map((s) => s.sleepMinutes));
      const prevWeekSleep = avg(prev7.map((s) => s.sleepMinutes));
      const thisWeekHR = avg(
        last7.map((s) => (s.restingHeartRate ? Number(s.restingHeartRate) : null)),
      );
      const prevWeekHR = avg(
        prev7.map((s) => (s.restingHeartRate ? Number(s.restingHeartRate) : null)),
      );

      // Steps trend
      if (thisWeekSteps !== null && prevWeekSteps !== null && prevWeekSteps > 0) {
        const pctChange = ((thisWeekSteps - prevWeekSteps) / prevWeekSteps) * 100;
        if (Math.abs(pctChange) >= 15) {
          const direction = pctChange > 0 ? "up" : "down";
          insights.push({
            insightTypeId: "health.wellness.trend",
            title: `Steps ${direction} ${Math.abs(pctChange).toFixed(0)}% vs last week`,
            description: `Your daily steps averaged ${Math.round(thisWeekSteps).toLocaleString()} this week vs ${Math.round(prevWeekSteps).toLocaleString()} last week.`,
            data: {
              metric: "steps",
              thisWeek: Math.round(thisWeekSteps),
              prevWeek: Math.round(prevWeekSteps),
              pctChange: Math.round(pctChange),
            },
            critical: false,
          });
        }
      }

      // Resting HR trend (a decrease is good)
      if (thisWeekHR !== null && prevWeekHR !== null) {
        const delta = thisWeekHR - prevWeekHR;
        if (Math.abs(delta) >= 3) {
          const direction = delta < 0 ? "dropped" : "increased";
          const sentiment = delta < 0 ? "improving" : "elevated";
          insights.push({
            insightTypeId: "health.wellness.trend",
            title: `Resting heart rate ${direction} ${Math.abs(delta).toFixed(0)} bpm`,
            description: `Your resting HR averaged ${thisWeekHR.toFixed(0)} bpm this week (was ${prevWeekHR.toFixed(0)} bpm). Your cardiovascular fitness looks ${sentiment}.`,
            data: {
              metric: "resting_heart_rate",
              thisWeek: Math.round(thisWeekHR),
              prevWeek: Math.round(prevWeekHR),
              delta: Math.round(delta),
            },
            critical: false,
          });
        }
      }
    }

    // ─── JOB E: Anomalies ────────────────────────────────────────
    if (todaySummary && summaries.length >= 7) {
      const avgHR = avg(
        summaries
          .slice(1, 15)
          .map((s) => (s.restingHeartRate ? Number(s.restingHeartRate) : null)),
      );

      if (
        avgHR !== null &&
        todaySummary.restingHeartRate &&
        Number(todaySummary.restingHeartRate) > avgHR + 10
      ) {
        insights.push({
          insightTypeId: "health.wellness.anomaly",
          title: `Resting HR unusually high: ${Number(todaySummary.restingHeartRate).toFixed(0)} bpm`,
          description: `Your resting heart rate was ${(Number(todaySummary.restingHeartRate) - avgHR).toFixed(0)} bpm above your 2-week average of ${avgHR.toFixed(0)} bpm. This can signal stress, illness, or poor recovery.`,
          data: {
            current: Number(todaySummary.restingHeartRate),
            average: Math.round(avgHR),
            delta: Math.round(Number(todaySummary.restingHeartRate) - avgHR),
          },
          critical: true,
        });
      }
    }

    // ─── JOB F: Weekly Summary (run on Mondays or every 7 days) ──
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek === 1 && last7.length >= 5) {
      // Monday
      const avgSteps = avg(last7.map((s) => s.steps));
      const avgSleepMin = avg(last7.map((s) => s.sleepMinutes));
      const totalWorkouts = last7.reduce(
        (sum, s) => sum + (s.workoutCount ?? 0),
        0,
      );
      const avgCalories = avg(last7.map((s) => s.activeCalories));

      const parts: string[] = [];
      if (avgSleepMin !== null) {
        const h = Math.floor(avgSleepMin / 60);
        const m = Math.round(avgSleepMin % 60);
        parts.push(`avg ${h}h ${m}m sleep`);
      }
      if (avgSteps !== null) {
        parts.push(`${Math.round(avgSteps).toLocaleString()} steps/day`);
      }
      if (totalWorkouts > 0) {
        parts.push(`${totalWorkouts} workouts`);
      }

      if (parts.length > 0) {
        insights.push({
          insightTypeId: "health.wellness.weekly-summary",
          title: `Week in review: ${parts.join(", ")}`,
          description: `Your health summary for the past week: ${parts.join(", ")}.${avgCalories !== null ? ` You burned an average of ${Math.round(avgCalories)} active calories per day.` : ""}`,
          data: {
            avgSteps: avgSteps !== null ? Math.round(avgSteps) : null,
            avgSleepMinutes: avgSleepMin !== null ? Math.round(avgSleepMin) : null,
            totalWorkouts,
            avgCalories: avgCalories !== null ? Math.round(avgCalories) : null,
            daysWithData: last7.length,
          },
          critical: false,
        });
      }
    }

    // ─── Update skill state ──────────────────────────────────────
    await ctx.setSkillState<SkillState>({
      lastRunAt: new Date().toISOString(),
      previousWeekAvg: {
        steps: avg(last7.map((s) => s.steps)),
        sleepMinutes: avg(last7.map((s) => s.sleepMinutes)),
        restingHR: avg(
          last7.map((s) =>
            s.restingHeartRate ? Number(s.restingHeartRate) : null,
          ),
        ),
      },
      streaks: {
        steps8k: stepsStreak,
        sleep7h: sleepStreak,
        exercise: 0,
      },
    });

    // ─── Update context facts ────────────────────────────────────
    await ctx.updateFacts({
      avg_daily_steps: avg(last7.map((s) => s.steps)),
      avg_sleep_minutes: avg(last7.map((s) => s.sleepMinutes)),
      avg_resting_hr: avg(
        last7.map((s) =>
          s.restingHeartRate ? Number(s.restingHeartRate) : null,
        ),
      ),
      steps_streak_days: stepsStreak,
      sleep_streak_days: sleepStreak,
      days_with_data: summaries.length,
    });

    return insights;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────

function avg(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
