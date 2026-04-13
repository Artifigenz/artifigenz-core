import { eq, and } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import {
  db,
  dataSourceConnections,
  healthMetrics,
  fileUploads,
} from "@artifigenz/db";
import type {
  DataSourceTypeDefinition,
  DataSourceConnectionResult,
  FinalizeParams,
  NormalizedData,
} from "../../../platform/registry/types";
import { parseHealthExport } from "../lib/health-parser";
import { computeDailySummaries } from "../lib/daily-summary";

type FileType = "xml" | "csv" | "text" | "pdf" | "image";

function inferFileType(filename: string): FileType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt")) return "text";
  if (lower.match(/\.(jpg|jpeg|png|webp)$/)) return "image";
  return "text";
}

/**
 * Apple Health export adapter — parses uploaded health data exports via Claude API.
 *
 * Flow:
 * 1. User exports health data from Apple Health app (Settings > Health > Export)
 * 2. User uploads the export.xml file (or a screenshot/CSV from other health apps)
 * 3. Claude extracts all health metrics (steps, sleep, HR, workouts, etc.)
 * 4. Metrics are stored in health_metrics, daily summaries are computed
 */
export const appleHealthAdapter: DataSourceTypeDefinition = {
  typeId: "apple-health",
  name: "Apple Health Export",
  description:
    "Upload your Apple Health export to get instant insights on sleep, activity, heart rate, and more",
  connectionFlow: "file_upload",
  syncMechanism: "manual",

  async getConnectionConfig(agentInstanceId: string) {
    return {
      uploadEndpoint: `/api/upload/health`,
      agentInstanceId,
      acceptedTypes: [
        "text/xml",
        "application/xml",
        "text/csv",
        "text/plain",
        "application/pdf",
        "image/*",
      ],
      maxFileSizeMb: 50, // Health exports can be large
      instructions:
        "Export from Apple Health: Open Health app > Profile icon > Export All Health Data. Upload the export.xml file.",
    };
  },

  async finalizeConnection(
    params: FinalizeParams,
  ): Promise<DataSourceConnectionResult> {
    const { agentInstanceId } = params;

    // Check if a connection already exists
    const existing = await db
      .select()
      .from(dataSourceConnections)
      .where(
        and(
          eq(dataSourceConnections.agentInstanceId, agentInstanceId),
          eq(dataSourceConnections.dataSourceTypeId, "apple-health"),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const conn = existing[0];
      return {
        id: conn.id,
        agentInstanceId: conn.agentInstanceId,
        dataSourceTypeId: conn.dataSourceTypeId,
        displayName: conn.displayName ?? "",
        status: conn.status,
        credentials: {},
        metadata: (conn.metadata ?? {}) as Record<string, unknown>,
      };
    }

    const [conn] = await db
      .insert(dataSourceConnections)
      .values({
        agentInstanceId,
        dataSourceTypeId: "apple-health",
        displayName: "Apple Health Export",
        status: "active",
      })
      .returning();

    return {
      id: conn.id,
      agentInstanceId: conn.agentInstanceId,
      dataSourceTypeId: conn.dataSourceTypeId,
      displayName: conn.displayName ?? "",
      status: conn.status,
      credentials: {},
      metadata: {},
    };
  },

  async testConnection() {
    return true;
  },

  async disconnect(connection) {
    await db
      .update(dataSourceConnections)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(dataSourceConnections.id, connection.id));
  },

  /**
   * Processes pending health data file uploads.
   * Parses with Claude, stores metrics, computes daily summaries.
   */
  async sync(connection): Promise<NormalizedData[]> {
    const pending = await db
      .select()
      .from(fileUploads)
      .where(
        and(
          eq(fileUploads.dataSourceConnectionId, connection.id),
          eq(fileUploads.extractionStatus, "pending"),
        ),
      );

    const allExtracted: NormalizedData[] = [];

    for (const file of pending) {
      console.log(
        `[AppleHealthAdapter] Processing "${file.originalFilename}" (${file.fileType})`,
      );

      try {
        const fileContent = await readFile(file.storagePath);
        const fileType = inferFileType(file.originalFilename);

        const parsed = await parseHealthExport({
          fileType,
          fileContent,
          filename: file.originalFilename,
        });

        console.log(
          `[AppleHealthAdapter] Extracted ${parsed.metrics.length} health metrics`,
        );

        // Store metrics
        for (const metric of parsed.metrics) {
          await db
            .insert(healthMetrics)
            .values({
              agentInstanceId: connection.agentInstanceId,
              dataSourceConnectionId: connection.id,
              metricType: metric.metricType,
              value: metric.value.toString(),
              unit: metric.unit,
              recordDate: metric.recordDate,
              startTime: metric.startTime ? new Date(metric.startTime) : null,
              endTime: metric.endTime ? new Date(metric.endTime) : null,
              source: metric.source ?? "apple_health",
              rawData: metric.workoutType
                ? ({ workoutType: metric.workoutType } as Record<string, unknown>)
                : null,
            })
            .onConflictDoNothing();

          allExtracted.push(metric as unknown as NormalizedData);
        }

        // Compute daily summaries
        if (parsed.dataRange) {
          await computeDailySummaries(
            connection.agentInstanceId,
            parsed.dataRange.start,
            parsed.dataRange.end,
          );
        } else if (parsed.metrics.length > 0) {
          const dates = parsed.metrics.map((m) => m.recordDate).sort();
          await computeDailySummaries(
            connection.agentInstanceId,
            dates[0],
            dates[dates.length - 1],
          );
        }

        // Mark file as processed
        await db
          .update(fileUploads)
          .set({
            extractionStatus: "processed",
            extractionResult: {
              metricsCount: parsed.metrics.length,
              dataRange: parsed.dataRange,
              deviceSources: parsed.deviceSources,
            },
            transactionCount: parsed.metrics.length,
            processedAt: new Date(),
          })
          .where(eq(fileUploads.id, file.id));
      } catch (err) {
        console.error(`[AppleHealthAdapter] Failed to process file:`, err);
        await db
          .update(fileUploads)
          .set({
            extractionStatus: "failed",
            extractionResult: {
              error: err instanceof Error ? err.message : String(err),
            },
          })
          .where(eq(fileUploads.id, file.id));
      }
    }

    await db
      .update(dataSourceConnections)
      .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(dataSourceConnections.id, connection.id));

    return allExtracted;
  },
};
