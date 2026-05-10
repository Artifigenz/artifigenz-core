import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { db, fileUploads, dataSourceConnections } from "@artifigenz/db";
import { parseStatement, type ParsedStatement } from "../lib/statement-parser";
import { upsertAccount } from "./account-matcher";
import { insertTransactions, prepareTransaction } from "./dedup";

type FileType = "pdf" | "csv" | "text" | "image";

function inferFileType(filename: string): FileType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".txt")) return "text";
  if (lower.match(/\.(jpg|jpeg|png|webp)$/)) return "image";
  return "text";
}

export interface UploadIngestResult {
  parsed: ParsedStatement;
  accountId: string;
  transactionsInserted: number;
  transactionsSkipped: number;
}

/**
 * Full ingest path for a single uploaded statement:
 *   1. read file, parse with Claude → institution/last4/accountType + txns
 *   2. upsert finance_accounts via (institution + last4) identity
 *   3. dedup + insert transactions
 *
 * If the statement doesn't reveal an account number (rare), we fall back to a
 * placeholder last4 of "0000" so the account still upserts deterministically.
 */
export async function ingestUpload(
  fileUploadId: string,
): Promise<UploadIngestResult> {
  const [file] = await db
    .select()
    .from(fileUploads)
    .where(eq(fileUploads.id, fileUploadId))
    .limit(1);

  if (!file) throw new Error(`File upload ${fileUploadId} not found`);

  const [conn] = await db
    .select({
      id: dataSourceConnections.id,
      agentInstanceId: dataSourceConnections.agentInstanceId,
    })
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.id, file.dataSourceConnectionId))
    .limit(1);

  if (!conn) throw new Error(`Connection for upload ${fileUploadId} not found`);

  const fileType = inferFileType(file.originalFilename);
  const fileContent = await readFile(file.storagePath);

  const parsed = await parseStatement({
    fileType,
    fileContent,
    filename: file.originalFilename,
  });

  const last4 = parsed.accountLast4 ?? "0000";
  const accountId = await upsertAccount({
    agentInstanceId: conn.agentInstanceId,
    institutionName: parsed.institutionName ?? "Unknown",
    accountLast4: last4,
    dataSourceConnectionId: conn.id,
    name: parsed.accountName,
    mask: last4,
    type: parsed.accountType,
    currentBalance: parsed.closingBalance?.toString() ?? null,
  });

  const prepared = parsed.transactions.map((tx) =>
    prepareTransaction({
      raw: {
        transactionDate: tx.date,
        description: tx.description,
        merchantName: tx.merchantName,
        amount: tx.amount.toString(),
        source: "upload",
        accountName: tx.accountName ?? parsed.accountName,
        personalFinanceCategoryPrimary: tx.category,
        rawData: tx as unknown as Record<string, unknown>,
      },
      agentInstanceId: conn.agentInstanceId,
      accountId,
      dataSourceConnectionId: conn.id,
    }),
  );

  const stats = await insertTransactions(prepared);

  await db
    .update(fileUploads)
    .set({
      extractionStatus: "processed",
      extractionResult: parsed as unknown as Record<string, unknown>,
      transactionCount: parsed.transactions.length,
      processedAt: new Date(),
    })
    .where(eq(fileUploads.id, fileUploadId));

  await db
    .update(dataSourceConnections)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(dataSourceConnections.id, conn.id));

  return {
    parsed,
    accountId,
    transactionsInserted: stats.inserted,
    transactionsSkipped: stats.skipped,
  };
}

/**
 * Ingest all pending uploads for a connection. Used after a batch upload.
 */
export async function ingestPendingUploadsForConnection(
  connectionId: string,
): Promise<UploadIngestResult[]> {
  const pending = await db
    .select({ id: fileUploads.id })
    .from(fileUploads)
    .where(eq(fileUploads.dataSourceConnectionId, connectionId));

  const results: UploadIngestResult[] = [];
  for (const f of pending) {
    try {
      const result = await ingestUpload(f.id);
      results.push(result);
    } catch (err) {
      console.error(`[upload-ingest] failed for ${f.id}:`, err);
      await db
        .update(fileUploads)
        .set({
          extractionStatus: "failed",
          extractionResult: {
            error: err instanceof Error ? err.message : String(err),
          },
        })
        .where(eq(fileUploads.id, f.id));
    }
  }
  return results;
}
