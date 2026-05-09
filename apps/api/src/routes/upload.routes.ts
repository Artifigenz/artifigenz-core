import { Hono } from "hono";
import { eq, and, gte } from "drizzle-orm";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  agentInstances,
  dataSourceConnections,
  fileUploads,
  financeTransactions,
  financeRecurringStreams,
} from "@artifigenz/db";
import { detectRecurring, type TxInput } from "../agents/finance/lib/recurring-detection";
import { normalizeMerchant } from "../agents/finance/lib/transaction-normalizer";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { fileUploadAdapter } from "../agents/finance/data-sources/file-upload.adapter";
import { appleHealthAdapter } from "../agents/health/data-sources/apple-health.adapter";
import { SkillExecutor } from "../platform/execution/skill-executor";
import { AgentRegistry } from "../platform/registry/agent-registry";
import { register as registerFinance } from "../agents/finance";
import { register as registerHealth } from "../agents/health";

const app = new Hono();
app.use("/*", clerkAuth);

// Inline registry for skill execution
const inlineRegistry = new AgentRegistry();
registerFinance(inlineRegistry);
registerHealth(inlineRegistry);
const executor = new SkillExecutor(inlineRegistry);

/**
 * Runs recurring detection on all transactions for an agent instance
 * and upserts the results into financeRecurringStreams.
 */
async function runRecurringDetection(agentInstanceId: string): Promise<number> {
  // Fetch all transactions for this agent instance
  const transactions = await db
    .select({
      id: financeTransactions.id,
      transactionDate: financeTransactions.transactionDate,
      merchantName: financeTransactions.merchantName,
      description: financeTransactions.description,
      amount: financeTransactions.amount,
      accountName: financeTransactions.accountName,
      category: financeTransactions.personalFinanceCategoryPrimary,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, agentInstanceId));

  if (transactions.length === 0) return 0;

  // Map to TxInput format
  const txInputs: TxInput[] = transactions.map((tx) => ({
    id: tx.id,
    transactionDate: tx.transactionDate,
    merchantName: tx.merchantName,
    description: tx.description,
    amount: parseFloat(tx.amount),
    accountName: tx.accountName,
    category: tx.category,
  }));

  // Run recurring detection
  const detected = detectRecurring(txInputs);

  // Upsert into financeRecurringStreams
  for (const sub of detected) {
    // Generate a synthetic stream ID based on merchant + account
    const normalizedMerchant = normalizeMerchant(sub.merchantName);
    const streamId = `upload-${normalizedMerchant}-${sub.accountName ?? "default"}`;

    await db
      .insert(financeRecurringStreams)
      .values({
        agentInstanceId,
        plaidStreamId: streamId,
        direction: "outflow",
        merchantName: sub.merchantName,
        description: `Detected from ${sub.transactionCount} uploaded transactions`,
        averageAmount: sub.amount.toFixed(2),
        frequency: sub.frequency.toUpperCase(),
        lastDate: sub.lastChargeDate,
        predictedNextDate: sub.nextChargeDate,
        status: "MATURE",
      })
      .onConflictDoUpdate({
        target: [financeRecurringStreams.agentInstanceId, financeRecurringStreams.plaidStreamId],
        set: {
          merchantName: sub.merchantName,
          averageAmount: sub.amount.toFixed(2),
          frequency: sub.frequency.toUpperCase(),
          lastDate: sub.lastChargeDate,
          predictedNextDate: sub.nextChargeDate,
          updatedAt: new Date(),
        },
      });
  }

  return detected.length;
}

/**
 * POST /api/upload
 *
 * Accepts a multipart file upload (bank statement PDF, CSV, image).
 * Processes everything inline (no Redis workers needed):
 *   1. Save file to disk
 *   2. Create/reuse a file-upload data source connection
 *   3. Create a file_uploads row
 *   4. Parse with Claude (via file upload adapter)
 *   5. Run subscriptions skill on the new data
 *   6. Return the results
 *
 * This takes ~20-30s for Claude parsing. The client should show a loader.
 */
app.post("/", async (c) => {
  const user = c.get("user");

  // Parse multipart form data
  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!file || typeof (file as any).arrayBuffer !== "function") {
    return c.json({ error: "No file provided. Send a 'file' field." }, 400);
  }

  // Cast to a common shape — Node's FormData returns Blob-like objects,
  // not necessarily the global File class (which may not exist in older Node).
  const f = file as unknown as { name?: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };
  const fileName = f.name ?? `upload-${Date.now()}`;
  const fileType = f.type ?? "application/octet-stream";
  const fileSize = f.size ?? 0;

  const allowedTypes = [
    "application/pdf",
    "text/csv",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
  ];
  if (!allowedTypes.some((t) => fileType.startsWith(t.split("/")[0]))) {
    return c.json(
      {
        error: `Unsupported file type: ${fileType}. Accepted: PDF, CSV, text, JPEG, PNG, WebP.`,
      },
      400,
    );
  }

  if (fileSize > 10 * 1024 * 1024) {
    return c.json({ error: "File too large. Max 10MB." }, 400);
  }

  // ─── 1. Find or create finance agent instance ──────────────────
  const [agentInstance] = await db
    .select()
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
        eq(agentInstances.status, "active"),
      ),
    )
    .limit(1);

  if (!agentInstance) {
    return c.json(
      { error: "Finance agent not activated. Activate it first." },
      400,
    );
  }

  // ─── 2. Save file to disk ─────────────────────────────────────
  const uploadDir = join(tmpdir(), "artifigenz-uploads", user.id);
  await mkdir(uploadDir, { recursive: true });
  const filepath = join(uploadDir, `${Date.now()}-${fileName}`);
  const buffer = Buffer.from(await f.arrayBuffer());
  await writeFile(filepath, buffer);

  // ─── 3. Create/reuse data source connection ───────────────────
  const connection = await fileUploadAdapter.finalizeConnection({
    agentInstanceId: agentInstance.id,
    dataSourceTypeId: "file-upload",
  });

  // ─── 4. Create file_uploads row ───────────────────────────────
  await db.insert(fileUploads).values({
    dataSourceConnectionId: connection.id,
    originalFilename: fileName,
    fileType: fileType.includes("pdf")
      ? "pdf"
      : fileType.includes("csv") || fileType.includes("text")
        ? "csv"
        : "image",
    storagePath: filepath,
    fileSizeBytes: fileSize,
    extractionStatus: "pending",
  });

  // ─── 5. Parse with Claude (inline, ~20s) ──────────────────────
  const syncResult = await fileUploadAdapter.sync(connection);

  // ─── 6. Run recurring detection on all transactions ──────────
  const recurringCount = await runRecurringDetection(agentInstance.id);

  // ─── 7. Run subscriptions skill on the new data ───────────────
  const skillResult = await executor.execute({
    agentInstanceId: agentInstance.id,
    skillId: "finance.subscriptions",
  });

  return c.json({
    status: "processed",
    file: {
      name: fileName,
      size: fileSize,
      type: fileType,
    },
    transactions: syncResult.length,
    recurringStreams: recurringCount,
    insights: skillResult.insightIds.length,
  });
});

/**
 * POST /api/upload/health
 *
 * Accepts an Apple Health export (XML, CSV, PDF, image).
 * Same inline-processing pattern as finance uploads.
 */
app.post("/health", async (c) => {
  const user = c.get("user");

  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!file || typeof (file as any).arrayBuffer !== "function") {
    return c.json({ error: "No file provided. Send a 'file' field." }, 400);
  }

  const f = file as unknown as { name?: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };
  const fileName = f.name ?? `upload-${Date.now()}`;
  const fileType = f.type ?? "application/octet-stream";
  const fileSize = f.size ?? 0;

  if (fileSize > 50 * 1024 * 1024) {
    return c.json({ error: "File too large. Max 50MB." }, 400);
  }

  // 1. Find health agent instance
  const [agentInstance] = await db
    .select()
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "health"),
        eq(agentInstances.status, "active"),
      ),
    )
    .limit(1);

  if (!agentInstance) {
    return c.json({ error: "Health agent not activated. Activate it first." }, 400);
  }

  // 2. Save file to disk
  const uploadDir = join(tmpdir(), "artifigenz-uploads", user.id);
  await mkdir(uploadDir, { recursive: true });
  const filepath = join(uploadDir, `${Date.now()}-${fileName}`);
  const buffer = Buffer.from(await f.arrayBuffer());
  await writeFile(filepath, buffer);

  // 3. Create/reuse data source connection
  const connection = await appleHealthAdapter.finalizeConnection({
    agentInstanceId: agentInstance.id,
    dataSourceTypeId: "apple-health",
  });

  // 4. Create file_uploads row
  await db.insert(fileUploads).values({
    dataSourceConnectionId: connection.id,
    originalFilename: fileName,
    fileType: fileType.includes("xml")
      ? "xml"
      : fileType.includes("csv") || fileType.includes("text")
        ? "csv"
        : fileType.includes("pdf")
          ? "pdf"
          : "image",
    storagePath: filepath,
    fileSizeBytes: fileSize,
    extractionStatus: "pending",
  });

  // 5. Parse with Claude (inline, ~20-30s)
  const syncResult = await appleHealthAdapter.sync(connection);

  // 6. Run wellness skill on the new data
  const skillResult = await executor.execute({
    agentInstanceId: agentInstance.id,
    skillId: "health.wellness",
  });

  return c.json({
    status: "processed",
    file: { name: fileName, size: fileSize, type: fileType },
    metrics: syncResult.length,
    insights: skillResult.insightIds.length,
  });
});

/**
 * GET /api/upload/history
 * Get upload history for the current user's finance agent
 */
app.get("/history", async (c) => {
  const user = c.get("user");

  // Get the user's finance agent instance
  const [instance] = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .limit(1);

  if (!instance) {
    return c.json({ uploads: [] });
  }

  // Get the file-upload connection
  const [connection] = await db
    .select()
    .from(dataSourceConnections)
    .where(
      and(
        eq(dataSourceConnections.agentInstanceId, instance.id),
        eq(dataSourceConnections.dataSourceTypeId, "file-upload"),
      ),
    )
    .limit(1);

  if (!connection) {
    return c.json({ uploads: [], lastSyncedAt: null });
  }

  // Get all uploads for this connection
  const uploads = await db
    .select({
      id: fileUploads.id,
      filename: fileUploads.originalFilename,
      fileType: fileUploads.fileType,
      status: fileUploads.extractionStatus,
      transactionCount: fileUploads.transactionCount,
      uploadedAt: fileUploads.uploadedAt,
      processedAt: fileUploads.processedAt,
      extractionResult: fileUploads.extractionResult,
    })
    .from(fileUploads)
    .where(eq(fileUploads.dataSourceConnectionId, connection.id))
    .orderBy(fileUploads.uploadedAt);

  // Extract statement periods from extraction results
  const uploadsWithPeriods = uploads.map((u) => {
    const result = u.extractionResult as { statement_period?: { start: string; end: string } } | null;
    return {
      id: u.id,
      filename: u.filename,
      fileType: u.fileType,
      status: u.status,
      transactionCount: u.transactionCount,
      uploadedAt: u.uploadedAt,
      processedAt: u.processedAt,
      statementPeriod: result?.statement_period ?? null,
    };
  });

  return c.json({
    uploads: uploadsWithPeriods,
    lastSyncedAt: connection.lastSyncedAt,
  });
});

/**
 * GET /api/upload/:fileId/status
 * Check status of a file upload (for future async processing)
 */
app.get("/:fileId/status", async (c) => {
  const [file] = await db
    .select()
    .from(fileUploads)
    .where(eq(fileUploads.id, c.req.param("fileId")))
    .limit(1);

  if (!file) return c.json({ error: "Not found" }, 404);

  return c.json({
    status: file.extractionStatus,
    transactionCount: file.transactionCount,
    processedAt: file.processedAt,
  });
});

/**
 * POST /api/upload/sync/:agentInstanceId
 *
 * Syncs all Plaid connections for an agent instance inline, then runs
 * the subscriptions skill. Used after Plaid Link finishes — since
 * workers are disabled, this does everything in one request.
 *
 * For Plaid sandbox, waits 5s for transactions to be generated.
 */
app.post("/sync/:agentInstanceId", async (c) => {
  const user = c.get("user");
  const agentInstanceId = c.req.param("agentInstanceId");

  // Verify the agent instance belongs to this user
  const [instance] = await db
    .select()
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.id, agentInstanceId),
        eq(agentInstances.userId, user.id),
      ),
    )
    .limit(1);

  if (!instance) {
    return c.json({ error: "Agent instance not found" }, 404);
  }

  // Find all active Plaid connections for this instance
  const connections = await db
    .select()
    .from(dataSourceConnections)
    .where(
      and(
        eq(dataSourceConnections.agentInstanceId, agentInstanceId),
        eq(dataSourceConnections.dataSourceTypeId, "plaid"),
        eq(dataSourceConnections.status, "active"),
      ),
    );

  if (connections.length === 0) {
    return c.json({ error: "No Plaid connections found" }, 400);
  }

  // Import the Plaid adapter
  const { plaidAdapter } = await import(
    "../agents/finance/data-sources/plaid.adapter"
  );

  // Wait a bit for sandbox transactions to be generated
  if (process.env.PLAID_ENV === "sandbox") {
    await new Promise((r) => setTimeout(r, 5000));
  }

  let totalTransactions = 0;

  for (const conn of connections) {
    try {
      const result = await plaidAdapter.sync({
        id: conn.id,
        agentInstanceId: conn.agentInstanceId,
        dataSourceTypeId: conn.dataSourceTypeId,
        displayName: conn.displayName ?? "",
        status: conn.status,
        credentials: (conn.credentialsEncrypted ?? {}) as Record<string, unknown>,
        metadata: (conn.metadata ?? {}) as Record<string, unknown>,
      });
      totalTransactions += result.length;
    } catch (err) {
      console.error(`[sync] Failed to sync connection ${conn.id}:`, err);
    }
  }

  // Run recurring detection on all transactions
  let recurringCount = 0;
  try {
    recurringCount = await runRecurringDetection(agentInstanceId);
  } catch (err) {
    console.error(`[sync] Failed to run recurring detection:`, err);
  }

  // Run the subscriptions skill
  let insightCount = 0;
  try {
    const skillResult = await executor.execute({
      agentInstanceId,
      skillId: "finance.subscriptions",
    });
    insightCount = skillResult.insightIds.length;
  } catch (err) {
    console.error(`[sync] Failed to run skill:`, err);
  }

  return c.json({
    status: "synced",
    connections: connections.length,
    transactions: totalTransactions,
    recurringStreams: recurringCount,
    insights: insightCount,
  });
});

export default app;
