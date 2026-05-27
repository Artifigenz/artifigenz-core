import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import {
  db,
  fileUploads,
  dataSourceConnections,
  agentInstances,
  financeAccounts,
  financeTransactions,
} from "@artifigenz/db";
import {
  parseStatement,
  validateStatement,
  type ParsedStatement,
  type ValidationResult,
} from "../lib/statement-parser";
import { normalizeInstitution, upsertAccount } from "./account-matcher";
import { insertTransactions, prepareTransaction } from "./dedup";

/**
 * Statement uploads don't carry a Plaid-style institution_id. Resolve one
 * cross-source: first prefer an institution_id already stamped on prior
 * transactions for this account (the canonical case when Plaid + statement
 * resolved to the same account row), then fall back to any sibling Plaid
 * connection on this agent_instance whose normalized institutionName matches.
 * Returns null when neither source can provide one.
 */
async function resolveInstitutionId(args: {
  agentInstanceId: string;
  accountId: string;
  institutionName: string | null | undefined;
}): Promise<string | null> {
  const [existing] = await db
    .select({ institutionId: financeTransactions.institutionId })
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.accountId, args.accountId),
        isNotNull(financeTransactions.institutionId),
      ),
    )
    .limit(1);
  if (existing?.institutionId) return existing.institutionId;

  const target = normalizeInstitution(args.institutionName);
  if (target === "unknown") return null;

  const siblings = await db
    .select({ metadata: dataSourceConnections.metadata })
    .from(dataSourceConnections)
    .where(
      and(
        eq(dataSourceConnections.agentInstanceId, args.agentInstanceId),
        eq(dataSourceConnections.dataSourceTypeId, "plaid"),
      ),
    );
  for (const s of siblings) {
    const meta = (s.metadata ?? {}) as {
      institutionName?: string;
      institutionId?: string;
    };
    if (
      meta.institutionId &&
      normalizeInstitution(meta.institutionName) === target
    ) {
      return meta.institutionId;
    }
  }
  return null;
}

type FileType = "pdf" | "csv" | "text" | "image";

function inferFileType(filename: string): FileType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".txt")) return "text";
  if (lower.match(/\.(jpg|jpeg|png|webp)$/)) return "image";
  return "text";
}

export interface ValidateUploadResult {
  validation: ValidationResult;
  accountId: string | null;
  rejected: boolean;
}

/**
 * Phase 1: validate-only. Runs the short Claude classifier to confirm the
 * file is a bank statement and pull institution/last4/type/period. Upserts
 * the account row immediately so the user sees "RBC Royal Bank ••8794" on
 * their upload tile. No transaction extraction yet — that's deferred until
 * the processing page polls /api/finance/agent-status.
 */
export async function validateUpload(
  fileUploadId: string,
): Promise<ValidateUploadResult> {
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

  let validation: ValidationResult;
  try {
    validation = await validateStatement({
      fileType,
      fileContent,
      filename: file.originalFilename,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(fileUploads)
      .set({
        parseState: "failed",
        parseError: `Validator error: ${msg}`,
      })
      .where(eq(fileUploads.id, fileUploadId));
    throw err;
  }

  if (!validation.isStatement) {
    await db
      .update(fileUploads)
      .set({
        parseState: "failed",
        parseError:
          validation.rejectionReason ?? "Not recognized as a bank statement",
      })
      .where(eq(fileUploads.id, fileUploadId));
    return { validation, accountId: null, rejected: true };
  }

  // Even when validation succeeds, the bank/last4 may be missing for older
  // statements. We still upsert under "Unknown ••0000" so transactions land
  // somewhere — the user can fix the metadata later.
  const last4 = validation.accountLast4 ?? "0000";
  const accountId = await upsertAccount({
    agentInstanceId: conn.agentInstanceId,
    institutionName: validation.institutionName ?? "Unknown",
    accountLast4: last4,
    dataSourceConnectionId: conn.id,
    name: validation.accountName,
    mask: last4,
    type: validation.accountType,
  });

  await db
    .update(fileUploads)
    .set({
      parseState: "validated",
      parseError: null,
      institutionName: validation.institutionName,
      accountLast4: last4,
      accountType: validation.accountType,
      statementPeriodStart: validation.statementPeriod?.start ?? null,
      statementPeriodEnd: validation.statementPeriod?.end ?? null,
      accountId,
    })
    .where(eq(fileUploads.id, fileUploadId));

  // Mark connection as actively ingesting so the loading screen sees us.
  await db
    .update(dataSourceConnections)
    .set({
      ingestionState: "in_progress",
      ingestionStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dataSourceConnections.id, conn.id),
        // don't overwrite a 'complete' state — only kick in_progress if pending
        inArray(dataSourceConnections.ingestionState, ["pending", "in_progress"]),
      ),
    );

  return { validation, accountId, rejected: false };
}

export interface ParseUploadFullResult {
  parsed: ParsedStatement;
  transactionsInserted: number;
  transactionsSkipped: number;
}

/**
 * Phase 2: full transaction extraction. Called by the agent-status poller
 * once the file is in the 'validated' state. Sets parse_state='parsing'
 * up front so concurrent calls are skipped.
 */
export async function parseUploadFull(
  fileUploadId: string,
): Promise<ParseUploadFullResult | null> {
  // Atomic claim — only proceed if still validated.
  const claimed = await db
    .update(fileUploads)
    .set({ parseState: "parsing" })
    .where(
      and(
        eq(fileUploads.id, fileUploadId),
        eq(fileUploads.parseState, "validated"),
      ),
    )
    .returning({ id: fileUploads.id });
  if (claimed.length === 0) return null;

  try {
    const [file] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, fileUploadId))
      .limit(1);
    if (!file) throw new Error(`File ${fileUploadId} not found mid-parse`);

    const [conn] = await db
      .select({
        id: dataSourceConnections.id,
        agentInstanceId: dataSourceConnections.agentInstanceId,
      })
      .from(dataSourceConnections)
      .where(eq(dataSourceConnections.id, file.dataSourceConnectionId))
      .limit(1);
    if (!conn) throw new Error(`Connection for ${fileUploadId} not found`);

    const accountId = file.accountId;
    if (!accountId) {
      throw new Error(`File ${fileUploadId} has no account_id — validation skipped?`);
    }

    // Pull userId + account snapshot so the txn rows carry the canonical
    // user_id / account_type / account_mask / currency columns.
    const [ai] = await db
      .select({ userId: agentInstances.userId })
      .from(agentInstances)
      .where(eq(agentInstances.id, conn.agentInstanceId))
      .limit(1);
    const userId = ai?.userId ?? null;

    const [acct] = await db
      .select({
        type: financeAccounts.type,
        last4: financeAccounts.accountLast4,
        currency: financeAccounts.isoCurrencyCode,
      })
      .from(financeAccounts)
      .where(eq(financeAccounts.id, accountId))
      .limit(1);

    const fileType = inferFileType(file.originalFilename);
    const fileContent = await readFile(file.storagePath);

    const parsed = await parseStatement({
      fileType,
      fileContent,
      filename: file.originalFilename,
    });

    const institutionId = await resolveInstitutionId({
      agentInstanceId: conn.agentInstanceId,
      accountId,
      institutionName: file.institutionName,
    });

    const prepared = parsed.transactions.map((tx) =>
      prepareTransaction({
        raw: {
          transactionDate: tx.date,
          description: tx.description,
          merchantName: tx.merchantName,
          amount: tx.amount.toString(),
          source: "statement",
          accountName: tx.accountName ?? parsed.accountName,
          accountType: acct?.type ?? null,
          accountMask: acct?.last4 ?? null,
          currency: acct?.currency ?? null,
          institutionId,
          personalFinanceCategoryPrimary: tx.category,
          rawData: tx as unknown as Record<string, unknown>,
        },
        agentInstanceId: conn.agentInstanceId,
        userId,
        accountId,
        dataSourceConnectionId: conn.id,
      }),
    );

    const stats = await insertTransactions(prepared);

    // If every row failed to insert, the file landed nothing useful —
    // mark it failed with the first row's error so the loading page can
    // explain it. If only some failed, complete but log a warning.
    const allRowsFailed =
      prepared.length > 0 &&
      stats.errors.length === prepared.length &&
      stats.inserted === 0;
    if (allRowsFailed) {
      const first = stats.errors[0];
      await db
        .update(fileUploads)
        .set({
          parseState: "failed",
          parseError: `Could not save extracted transactions: ${first.error}`,
          extractionStatus: "failed",
        })
        .where(eq(fileUploads.id, fileUploadId));
      throw new Error(
        `All ${stats.errors.length} extracted rows failed to insert. First: ${first.error}`,
      );
    }
    if (stats.errors.length > 0) {
      console.warn(
        `[parseUploadFull] ${stats.errors.length}/${prepared.length} rows failed to insert for ${fileUploadId}`,
      );
    }

    await db
      .update(fileUploads)
      .set({
        parseState: "complete",
        extractionStatus: "processed",
        extractionResult: parsed as unknown as Record<string, unknown>,
        transactionCount: parsed.transactions.length,
        processedAt: new Date(),
      })
      .where(eq(fileUploads.id, fileUploadId));

    // Maybe the whole connection is done now — check all files.
    await maybeMarkConnectionComplete(conn.id);

    return {
      parsed,
      transactionsInserted: stats.inserted,
      transactionsSkipped: stats.skipped,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(fileUploads)
      .set({
        parseState: "failed",
        parseError: msg,
        extractionStatus: "failed",
      })
      .where(eq(fileUploads.id, fileUploadId));
    throw err;
  }
}

/**
 * If every file on the connection is complete or failed, transition the
 * connection's ingestion_state to 'complete'. Called after each full parse.
 */
async function maybeMarkConnectionComplete(connectionId: string): Promise<void> {
  const files = await db
    .select({ parseState: fileUploads.parseState })
    .from(fileUploads)
    .where(eq(fileUploads.dataSourceConnectionId, connectionId));

  if (files.length === 0) return;
  const allDone = files.every(
    (f) => f.parseState === "complete" || f.parseState === "failed",
  );
  if (!allDone) return;

  await db
    .update(dataSourceConnections)
    .set({
      ingestionState: "complete",
      ingestionCompletedAt: new Date(),
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dataSourceConnections.id, connectionId));
}

/**
 * Drive any pending/validated files on a connection toward complete.
 * - 'pending' files get validated (rare — usually validation runs inline
 *   on upload, but a retry path needs this)
 * - 'validated' files get fully parsed
 * Used by the agent-status endpoint as a throttled background trigger.
 */
export async function advanceUploadsForConnection(
  connectionId: string,
): Promise<{ validated: number; parsed: number }> {
  let validated = 0;
  let parsed = 0;

  const pending = await db
    .select({ id: fileUploads.id })
    .from(fileUploads)
    .where(
      and(
        eq(fileUploads.dataSourceConnectionId, connectionId),
        eq(fileUploads.parseState, "pending"),
      ),
    );
  for (const f of pending) {
    try {
      await validateUpload(f.id);
      validated++;
    } catch (err) {
      console.error(`[upload-ingest] validate failed for ${f.id}:`, err);
    }
  }

  const ready = await db
    .select({ id: fileUploads.id })
    .from(fileUploads)
    .where(
      and(
        eq(fileUploads.dataSourceConnectionId, connectionId),
        eq(fileUploads.parseState, "validated"),
      ),
    );
  for (const f of ready) {
    try {
      const result = await parseUploadFull(f.id);
      if (result) parsed++;
    } catch (err) {
      console.error(`[upload-ingest] parse failed for ${f.id}:`, err);
    }
  }

  return { validated, parsed };
}
