import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, healthMetrics, healthDailySummaries } from "@artifigenz/db";

/**
 * Computes daily summaries from raw health_metrics for a date range.
 * Upserts into health_daily_summaries.
 */
export async function computeDailySummaries(
  agentInstanceId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  // Get all metrics in the range
  const metrics = await db
    .select()
    .from(healthMetrics)
    .where(
      and(
        eq(healthMetrics.agentInstanceId, agentInstanceId),
        gte(healthMetrics.recordDate, startDate),
        lte(healthMetrics.recordDate, endDate),
      ),
    );

  // Group by date
  const byDate = new Map<string, typeof metrics>();
  for (const m of metrics) {
    const existing = byDate.get(m.recordDate) ?? [];
    existing.push(m);
    byDate.set(m.recordDate, existing);
  }

  let count = 0;

  for (const [date, dayMetrics] of byDate.entries()) {
    const steps = sumMetric(dayMetrics, "steps");
    const sleepMinutes = sumMetric(dayMetrics, "sleep_duration");
    const activeCalories = sumMetric(dayMetrics, "active_calories");
    const exerciseMinutes = sumMetric(dayMetrics, "exercise_minutes");
    const flightsClimbed = sumMetric(dayMetrics, "flights_climbed");
    const distanceKm = sumMetricDecimal(dayMetrics, "distance");
    const restingHR = latestMetric(dayMetrics, "heart_rate_resting");
    const weight = latestMetric(dayMetrics, "weight");

    // Count workouts and collect types
    const workouts = dayMetrics.filter((m) => m.metricType === "workout");
    const workoutTypes = [
      ...new Set(
        workouts
          .map((w) => (w.rawData as { workoutType?: string })?.workoutType)
          .filter(Boolean) as string[],
      ),
    ];

    await db
      .insert(healthDailySummaries)
      .values({
        agentInstanceId,
        summaryDate: date,
        steps: steps !== null ? Math.round(steps) : null,
        sleepMinutes: sleepMinutes !== null ? Math.round(sleepMinutes) : null,
        restingHeartRate: restingHR?.toString() ?? null,
        activeCalories: activeCalories !== null ? Math.round(activeCalories) : null,
        exerciseMinutes: exerciseMinutes !== null ? Math.round(exerciseMinutes) : null,
        weight: weight?.toString() ?? null,
        flightsClimbed: flightsClimbed !== null ? Math.round(flightsClimbed) : null,
        distanceKm: distanceKm?.toString() ?? null,
        workoutCount: workouts.length > 0 ? workouts.length : null,
        workoutTypes: workoutTypes.length > 0 ? workoutTypes : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [healthDailySummaries.agentInstanceId, healthDailySummaries.summaryDate],
        set: {
          steps: steps !== null ? Math.round(steps) : null,
          sleepMinutes: sleepMinutes !== null ? Math.round(sleepMinutes) : null,
          restingHeartRate: restingHR?.toString() ?? null,
          activeCalories: activeCalories !== null ? Math.round(activeCalories) : null,
          exerciseMinutes: exerciseMinutes !== null ? Math.round(exerciseMinutes) : null,
          weight: weight?.toString() ?? null,
          flightsClimbed: flightsClimbed !== null ? Math.round(flightsClimbed) : null,
          distanceKm: distanceKm?.toString() ?? null,
          workoutCount: workouts.length > 0 ? workouts.length : null,
          workoutTypes: workoutTypes.length > 0 ? workoutTypes : null,
          updatedAt: new Date(),
        },
      });

    count++;
  }

  return count;
}

// ─── Helpers ──────────────────────────────────────────────────────

type MetricRow = typeof healthMetrics.$inferSelect;

function sumMetric(metrics: MetricRow[], type: string): number | null {
  const matching = metrics.filter((m) => m.metricType === type);
  if (matching.length === 0) return null;
  return matching.reduce((sum, m) => sum + Number(m.value), 0);
}

function sumMetricDecimal(metrics: MetricRow[], type: string): number | null {
  const matching = metrics.filter((m) => m.metricType === type);
  if (matching.length === 0) return null;
  return matching.reduce((sum, m) => sum + Number(m.value), 0);
}

function latestMetric(metrics: MetricRow[], type: string): number | null {
  const matching = metrics.filter((m) => m.metricType === type);
  if (matching.length === 0) return null;
  // Return the last one (assuming they're in chronological order, or just take any)
  return Number(matching[matching.length - 1].value);
}
