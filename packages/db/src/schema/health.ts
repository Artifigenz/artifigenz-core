import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  decimal,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agentInstances, dataSourceConnections } from "./platform";

// ─── Raw Health Metrics (time-series) ─────────────────────────────

export const healthMetrics = pgTable(
  "health_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceConnectionId: uuid("data_source_connection_id")
      .notNull()
      .references(() => dataSourceConnections.id, { onDelete: "cascade" }),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    metricType: varchar("metric_type", { length: 50 }).notNull(),
    value: decimal("value", { precision: 12, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 20 }).notNull(),
    recordDate: date("record_date").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    source: varchar("source", { length: 30 }).notNull(), // apple_health, google_fit, manual
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_health_metrics_agent_date").on(
      table.agentInstanceId,
      table.recordDate,
    ),
    index("idx_health_metrics_type").on(
      table.agentInstanceId,
      table.metricType,
      table.recordDate,
    ),
  ],
);

// ─── Daily Summaries (pre-computed rollups) ───────────────────────

export const healthDailySummaries = pgTable(
  "health_daily_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentInstanceId: uuid("agent_instance_id")
      .notNull()
      .references(() => agentInstances.id, { onDelete: "cascade" }),
    summaryDate: date("summary_date").notNull(),
    steps: integer("steps"),
    sleepMinutes: integer("sleep_minutes"),
    restingHeartRate: decimal("resting_heart_rate", { precision: 5, scale: 1 }),
    activeCalories: integer("active_calories"),
    exerciseMinutes: integer("exercise_minutes"),
    weight: decimal("weight", { precision: 5, scale: 1 }),
    flightsClimbed: integer("flights_climbed"),
    distanceKm: decimal("distance_km", { precision: 7, scale: 2 }),
    workoutCount: integer("workout_count"),
    workoutTypes: text("workout_types").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_health_daily_unique").on(
      table.agentInstanceId,
      table.summaryDate,
    ),
    index("idx_health_daily_agent_date").on(
      table.agentInstanceId,
      table.summaryDate,
    ),
  ],
);
