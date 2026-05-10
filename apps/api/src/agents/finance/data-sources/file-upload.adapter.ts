import { eq, and } from "drizzle-orm";
import {
  db,
  dataSourceConnections,
} from "@artifigenz/db";
import type {
  DataSourceTypeDefinition,
  DataSourceConnectionResult,
  FinalizeParams,
  NormalizedData,
} from "../../../platform/registry/types";
import { ingestPendingUploadsForConnection } from "../ingest/upload-ingest";

/**
 * File upload adapter — parses uploaded bank statements via Claude API.
 *
 * Flow:
 * 1. User uploads a file → POST /api/upload creates a file_uploads row (status=pending)
 *    and a data_source_connection if one doesn't exist for this user's finance agent
 * 2. adapter.sync() is called (via event or directly) to process pending files
 * 3. Each pending file is read, sent to Claude, and extracted transactions are stored
 * 4. File is marked as processed
 */
export const fileUploadAdapter: DataSourceTypeDefinition = {
  typeId: "file-upload",
  name: "Bank Statement Upload",
  description: "Upload bank statements (PDF, CSV, images) for analysis",
  connectionFlow: "file_upload",
  syncMechanism: "manual",

  async getConnectionConfig(agentInstanceId: string) {
    // For file upload, the "connection config" is just the endpoint the client posts to
    return {
      uploadEndpoint: `/api/upload`,
      agentInstanceId,
      acceptedTypes: ["application/pdf", "text/csv", "text/plain", "image/*"],
      maxFileSizeMb: 10,
    };
  },

  async finalizeConnection(params: FinalizeParams): Promise<DataSourceConnectionResult> {
    const { agentInstanceId } = params;

    // Check if a file-upload connection already exists for this agent
    // Select only columns we need (avoid new health columns that may not exist)
    const existing = await db
      .select({
        id: dataSourceConnections.id,
        agentInstanceId: dataSourceConnections.agentInstanceId,
        dataSourceTypeId: dataSourceConnections.dataSourceTypeId,
        displayName: dataSourceConnections.displayName,
        status: dataSourceConnections.status,
        metadata: dataSourceConnections.metadata,
      })
      .from(dataSourceConnections)
      .where(
        and(
          eq(dataSourceConnections.agentInstanceId, agentInstanceId),
          eq(dataSourceConnections.dataSourceTypeId, "file-upload"),
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

    // Create new connection (return only core columns)
    const [conn] = await db
      .insert(dataSourceConnections)
      .values({
        agentInstanceId,
        dataSourceTypeId: "file-upload",
        displayName: "Uploaded Statements",
        status: "active",
      })
      .returning({
        id: dataSourceConnections.id,
        agentInstanceId: dataSourceConnections.agentInstanceId,
        dataSourceTypeId: dataSourceConnections.dataSourceTypeId,
        displayName: dataSourceConnections.displayName,
        status: dataSourceConnections.status,
        metadata: dataSourceConnections.metadata,
      });

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
    return true; // No external connection to test
  },

  async disconnect(connection) {
    await db
      .update(dataSourceConnections)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(dataSourceConnections.id, connection.id));
  },

  /**
   * Sync delegates to ingest/upload-ingest which processes pending file_uploads:
   * Claude parsing → upsertAccount via (institution + last4) → dedup-insert txns.
   * Returns a synthetic array sized by total inserted txns for sync-worker logging.
   */
  async sync(connection): Promise<NormalizedData[]> {
    const results = await ingestPendingUploadsForConnection(connection.id);
    const totalInserted = results.reduce(
      (sum, r) => sum + r.transactionsInserted,
      0,
    );
    console.log(
      `[FileUploadAdapter] Processed ${results.length} file(s), inserted ${totalInserted} txn(s)`,
    );
    return Array.from({ length: totalInserted }, () => ({}) as NormalizedData);
  },
};
