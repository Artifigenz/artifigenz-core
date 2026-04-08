import { eq, and } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import {
  db,
  dataSourceConnections,
  financeTransactions,
  fileUploads,
} from "@artifigenz/db";
import type {
  DataSourceTypeDefinition,
  DataSourceConnectionResult,
  FinalizeParams,
  NormalizedData,
} from "../../../platform/registry/types";
import { parseStatement } from "../lib/statement-parser";

type FileType = "pdf" | "csv" | "text" | "image";

function inferFileType(filename: string): FileType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".txt")) return "text";
  if (lower.match(/\.(jpg|jpeg|png|webp)$/)) return "image";
  // Default to text
  return "text";
}

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
    const existing = await db
      .select()
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

    // Create new connection
    const [conn] = await db
      .insert(dataSourceConnections)
      .values({
        agentInstanceId,
        dataSourceTypeId: "file-upload",
        displayName: "Uploaded Statements",
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
    return true; // No external connection to test
  },

  async disconnect(connection) {
    await db
      .update(dataSourceConnections)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(dataSourceConnections.id, connection.id));
  },

  /**
   * Scans for any pending file uploads for this connection and processes them.
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
        `[FileUploadAdapter] Processing "${file.originalFilename}" (${file.fileType})`,
      );

      try {
        // Read file content
        const fileContent = await readFile(file.storagePath);
        const fileType = inferFileType(file.originalFilename);

        // Parse with Claude
        const parsed = await parseStatement({
          fileType,
          fileContent,
          filename: file.originalFilename,
        });

        console.log(
          `[FileUploadAdapter] Extracted ${parsed.transactions.length} transactions`,
        );

        // Store transactions
        for (const tx of parsed.transactions) {
          await db
            .insert(financeTransactions)
            .values({
              agentInstanceId: connection.agentInstanceId,
              dataSourceConnectionId: connection.id,
              transactionDate: tx.date,
              description: tx.description,
              merchantName: tx.merchantName,
              amount: tx.amount.toString(),
              category: tx.category,
              accountName: tx.accountName,
              source: "upload",
              rawData: tx as unknown as Record<string, unknown>,
            })
            .onConflictDoNothing();

          allExtracted.push(tx as unknown as NormalizedData);
        }

        // Mark file as processed
        await db
          .update(fileUploads)
          .set({
            extractionStatus: "processed",
            extractionResult: parsed as unknown as Record<string, unknown>,
            transactionCount: parsed.transactions.length,
            processedAt: new Date(),
          })
          .where(eq(fileUploads.id, file.id));
      } catch (err) {
        console.error(`[FileUploadAdapter] Failed to process file:`, err);
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
