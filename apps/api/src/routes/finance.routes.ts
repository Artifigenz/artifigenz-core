import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  agentInstances,
  financeTransactions,
  financeAccounts,
  financeBriefs,
  financeInsights,
  merchantClusters,
  fileUploads,
  dataSourceConnections,
  insights,
  agentInstanceSkills,
} from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import {
  categorizeAgentInstance,
  backfillOrphans,
} from "../agents/finance/categorize";
import { ingestPlaidConnection } from "../agents/finance/ingest/plaid-ingest";
import { advanceUploadsForConnection } from "../agents/finance/ingest/upload-ingest";

// How long between successive opportunistic Plaid syncs for a single
// connection. The frontend polls /agent-status every 3s during onboarding;
// without this throttle we'd hammer Plaid.
const SYNC_THROTTLE_MS = 30_000;

const app = new Hono();
app.use("/*", clerkAuth);

/**
 * POST /api/finance/categorize
 *   Runs LLM classification over all transactions for the user's finance
 *   agent. Idempotent: clusters whose latest txn is already analyzed are
 *   skipped. Returns counts so the caller can show progress.
 *
 *   This is the step-3 entry point of the unified-finance rewrite. It
 *   populates merchant_clusters and backfills
 *   finance_transactions.{category, is_recurring, merchant_cluster_id}.
 */
app.post("/categorize", async (c) => {
  const user = c.get("user");

  const [instance] = await db
    .select({ id: agentInstances.id, status: agentInstances.status })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .orderBy(agentInstances.createdAt)
    .limit(1);

  if (!instance) {
    return c.json({ error: "No finance agent found." }, 400);
  }
  if (instance.status === "inactive") {
    return c.json({ error: "Finance agent is inactive." }, 400);
  }

  try {
    const result = await categorizeAgentInstance(instance.id);
    const orphans = await backfillOrphans(instance.id);
    return c.json({ ...result, orphansBackfilled: orphans });
  } catch (err) {
    console.error("[finance/categorize] failed:", err);
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

/**
 * GET /api/finance/transactions
 *   Returns every consolidated transaction for the user's finance agent —
 *   the source-of-truth table that the breakdown page renders. Joins
 *   finance_transactions with finance_accounts so each row carries its
 *   institution + last4. Sorted newest first.
 */
app.get("/transactions", async (c) => {
  const user = c.get("user");

  const [instance] = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .orderBy(agentInstances.createdAt)
    .limit(1);

  if (!instance) return c.json({ error: "No finance agent found" }, 404);

  const rows = await db
    .select({
      id: financeTransactions.id,
      date: financeTransactions.transactionDate,
      description: financeTransactions.description,
      merchantName: financeTransactions.merchantName,
      merchantNormalized: financeTransactions.merchantNormalized,
      amount: financeTransactions.amount,
      source: financeTransactions.source,
      category: financeTransactions.category,
      isRecurring: financeTransactions.isRecurring,
      accountName: financeAccounts.name,
      institutionName: financeAccounts.institutionName,
      accountLast4: financeAccounts.accountLast4,
    })
    .from(financeTransactions)
    .leftJoin(financeAccounts, eq(financeAccounts.id, financeTransactions.accountId))
    .where(eq(financeTransactions.agentInstanceId, instance.id))
    .orderBy(desc(financeTransactions.transactionDate));

  let income = 0;
  let expenses = 0;
  for (const r of rows) {
    const amt = parseFloat(r.amount);
    // Sign convention: positive = money out, negative = money in.
    if (amt < 0) income += -amt;
    else expenses += amt;
  }

  return c.json({
    count: rows.length,
    totals: {
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      net: Math.round((income - expenses) * 100) / 100,
    },
    transactions: rows.map((r) => ({
      ...r,
      amount: parseFloat(r.amount),
    })),
  });
});

/**
 * GET /api/finance/agent-status
 *   The frontend onboarding loader polls this every ~3s to render the
 *   per-connection ingestion progress. Each call:
 *     - reads the current state from the DB
 *     - opportunistically kicks a Plaid sync if a connection is in_progress
 *       and hasn't been synced in SYNC_THROTTLE_MS (fire-and-forget)
 *     - returns whatever the truth is right now
 *
 *   The fire-and-forget sync is awaited only briefly via a 100ms grace
 *   period so the caller gets fresh-ish state without waiting for Plaid.
 */
app.get("/agent-status", async (c) => {
  const user = c.get("user");

  const [instance] = await db
    .select({ id: agentInstances.id, status: agentInstances.status })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .orderBy(agentInstances.createdAt)
    .limit(1);

  if (!instance) {
    return c.json({
      agentExists: false,
      ingestionComplete: true,
      totalTransactions: 0,
      connections: [],
    });
  }

  const conns = await db
    .select({
      id: dataSourceConnections.id,
      dataSourceTypeId: dataSourceConnections.dataSourceTypeId,
      displayName: dataSourceConnections.displayName,
      ingestionState: dataSourceConnections.ingestionState,
      ingestionStartedAt: dataSourceConnections.ingestionStartedAt,
      ingestionCompletedAt: dataSourceConnections.ingestionCompletedAt,
      lastSyncedAt: dataSourceConnections.lastSyncedAt,
      lastSyncStatus: dataSourceConnections.lastSyncStatus,
      lastSyncError: dataSourceConnections.lastSyncError,
      lastSyncAddedCount: dataSourceConnections.lastSyncAddedCount,
      consecutiveEmptySyncs: dataSourceConnections.consecutiveEmptySyncs,
    })
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.agentInstanceId, instance.id));

  // Compute per-connection transaction counts in one query.
  const counts = await db
    .select({
      accountId: financeAccounts.id,
      dataSourceConnectionId: financeAccounts.dataSourceConnectionId,
    })
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, instance.id));
  const accountToConn = new Map<string, string | null>();
  for (const a of counts) accountToConn.set(a.accountId, a.dataSourceConnectionId);

  const txRows = await db
    .select({
      id: financeTransactions.id,
      accountId: financeTransactions.accountId,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, instance.id));

  const perConnCount = new Map<string, number>();
  const perConnAccounts = new Map<string, Set<string>>();
  for (const tx of txRows) {
    if (!tx.accountId) continue;
    const connId = accountToConn.get(tx.accountId);
    if (!connId) continue;
    perConnCount.set(connId, (perConnCount.get(connId) ?? 0) + 1);
    if (!perConnAccounts.has(connId)) perConnAccounts.set(connId, new Set());
    perConnAccounts.get(connId)!.add(tx.accountId);
  }

  // Pull per-connection file_upload state so we can show parsing progress.
  const fileRows = await db
    .select({
      id: fileUploads.id,
      dataSourceConnectionId: fileUploads.dataSourceConnectionId,
      originalFilename: fileUploads.originalFilename,
      parseState: fileUploads.parseState,
      institutionName: fileUploads.institutionName,
      accountLast4: fileUploads.accountLast4,
      statementPeriodStart: fileUploads.statementPeriodStart,
      statementPeriodEnd: fileUploads.statementPeriodEnd,
    })
    .from(fileUploads)
    .where(
      inArray(
        fileUploads.dataSourceConnectionId,
        conns.map((c) => c.id),
      ),
    );
  const filesByConn = new Map<string, typeof fileRows>();
  for (const f of fileRows) {
    const arr = filesByConn.get(f.dataSourceConnectionId) ?? [];
    arr.push(f);
    filesByConn.set(f.dataSourceConnectionId, arr);
  }

  // Kick throttled Plaid syncs + file parses for in_progress connections.
  const now = Date.now();
  const triggered: string[] = [];
  for (const conn of conns) {
    const lastSyncMs = conn.lastSyncedAt
      ? new Date(conn.lastSyncedAt).getTime()
      : 0;

    if (conn.dataSourceTypeId === "plaid") {
      if (conn.ingestionState !== "in_progress" && conn.ingestionState !== "pending") continue;
      if (now - lastSyncMs < SYNC_THROTTLE_MS) continue;
      triggered.push(conn.id);
      void ingestPlaidConnection(conn.id).catch((err) => {
        console.error(`[agent-status] plaid sync failed for ${conn.id}:`, err);
      });
    } else if (conn.dataSourceTypeId === "file-upload") {
      // For file uploads, kick the parse advance if there are pending or
      // validated files. The validation step is idempotent and fast; the
      // full parse claims the row atomically so multiple polls don't race.
      const files = filesByConn.get(conn.id) ?? [];
      const hasWork = files.some(
        (f) => f.parseState === "validated" || f.parseState === "pending",
      );
      if (!hasWork) continue;
      // Throttle: only kick once per 5s per connection (parse is slow; we
      // don't want to spam Claude requests if a poll happens mid-parse).
      if (now - lastSyncMs < 5000) continue;
      triggered.push(conn.id);
      void advanceUploadsForConnection(conn.id).catch((err) => {
        console.error(`[agent-status] upload parse failed for ${conn.id}:`, err);
      });
    }
  }

  const ingestionComplete = conns.every(
    (c) =>
      c.ingestionState === "complete" ||
      c.ingestionState === "failed" ||
      c.ingestionState === "needs_auth",
  );

  return c.json({
    agentExists: true,
    agentInstanceId: instance.id,
    agentStatus: instance.status,
    ingestionComplete,
    totalTransactions: txRows.length,
    connections: conns.map((c) => {
      const files = filesByConn.get(c.id) ?? [];
      return {
        id: c.id,
        dataSourceTypeId: c.dataSourceTypeId,
        displayName: c.displayName,
        ingestionState: c.ingestionState,
        ingestionStartedAt: c.ingestionStartedAt,
        ingestionCompletedAt: c.ingestionCompletedAt,
        lastSyncedAt: c.lastSyncedAt,
        lastSyncStatus: c.lastSyncStatus,
        lastSyncError: c.lastSyncError,
        lastSyncAddedCount: c.lastSyncAddedCount,
        consecutiveEmptySyncs: c.consecutiveEmptySyncs,
        transactionCount: perConnCount.get(c.id) ?? 0,
        accountCount: (perConnAccounts.get(c.id) ?? new Set()).size,
        syncTriggered: triggered.includes(c.id),
        files: files.map((f) => ({
          id: f.id,
          filename: f.originalFilename,
          parseState: f.parseState,
          institutionName: f.institutionName,
          accountLast4: f.accountLast4,
          statementPeriodStart: f.statementPeriodStart,
          statementPeriodEnd: f.statementPeriodEnd,
        })),
      };
    }),
  });
});

/**
 * PATCH /api/finance/file-uploads/:fileId
 *   User-correctable metadata on an uploaded statement. Right now we only
 *   accept institutionName edits — fixes the "wrong bank" case where the
 *   validator was unsure or wrong. Re-points the linked account to the
 *   corrected (institution + last4) identity.
 */
app.patch("/file-uploads/:fileId", async (c) => {
  const user = c.get("user");
  const fileId = c.req.param("fileId");
  const body = await c.req.json<{ institutionName?: string }>();

  if (typeof body.institutionName !== "string" || !body.institutionName.trim()) {
    return c.json({ error: "institutionName is required" }, 400);
  }
  const newName = body.institutionName.trim();

  // Authorize — file must belong to one of this user's finance connections.
  const [row] = await db
    .select({
      fileId: fileUploads.id,
      accountId: fileUploads.accountId,
      accountLast4: fileUploads.accountLast4,
      connectionId: fileUploads.dataSourceConnectionId,
      agentInstanceId: dataSourceConnections.agentInstanceId,
      agentTypeId: agentInstances.agentTypeId,
      userId: agentInstances.userId,
    })
    .from(fileUploads)
    .leftJoin(
      dataSourceConnections,
      eq(dataSourceConnections.id, fileUploads.dataSourceConnectionId),
    )
    .leftJoin(
      agentInstances,
      eq(agentInstances.id, dataSourceConnections.agentInstanceId),
    )
    .where(eq(fileUploads.id, fileId))
    .limit(1);

  if (!row || row.userId !== user.id || row.agentTypeId !== "finance") {
    return c.json({ error: "File not found" }, 404);
  }

  await db
    .update(fileUploads)
    .set({ institutionName: newName })
    .where(eq(fileUploads.id, fileId));

  // Rename the linked account so the breakdown + accounts page reflect
  // the correction. If a different account already exists with the new
  // (institution, last4) identity, MERGE: re-point all txns and other
  // file_uploads from the old account onto the existing one, then drop
  // the old row. Without this, the unique constraint would fire and the
  // rename silently failed.
  if (row.accountId && row.agentInstanceId) {
    const normalized = newName.toLowerCase().replace(/\s+/g, " ").trim();
    const last4 = row.accountLast4;
    if (last4) {
      const [conflict] = await db
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(
          and(
            eq(financeAccounts.agentInstanceId, row.agentInstanceId),
            eq(financeAccounts.institutionName, normalized),
            eq(financeAccounts.accountLast4, last4),
          ),
        )
        .limit(1);

      if (conflict && conflict.id !== row.accountId) {
        // Merge: move children, drop the orphan.
        await db
          .update(financeTransactions)
          .set({ accountId: conflict.id })
          .where(eq(financeTransactions.accountId, row.accountId));
        await db
          .update(fileUploads)
          .set({ accountId: conflict.id })
          .where(eq(fileUploads.accountId, row.accountId));
        await db
          .delete(financeAccounts)
          .where(eq(financeAccounts.id, row.accountId));
      } else {
        await db
          .update(financeAccounts)
          .set({ institutionName: normalized })
          .where(eq(financeAccounts.id, row.accountId));
      }
    } else {
      await db
        .update(financeAccounts)
        .set({ institutionName: normalized })
        .where(eq(financeAccounts.id, row.accountId));
    }
  }

  return c.json({ success: true, institutionName: newName });
});

/**
 * GET /api/finance/accounts
 *   Lists every finance_account the user has, joined with its source
 *   signals — Plaid connection (if any) and uploaded statements (if any).
 *   One row per account, regardless of how many sources it has.
 */
app.get("/accounts", async (c) => {
  const user = c.get("user");

  const [instance] = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .orderBy(agentInstances.createdAt)
    .limit(1);

  if (!instance) return c.json({ accounts: [] });

  const accts = await db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, instance.id));

  // Pull every connection on the instance so we can attach source info.
  const conns = await db
    .select()
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.agentInstanceId, instance.id));
  const connById = new Map(conns.map((c) => [c.id, c]));

  // Pull every file_upload so each account can list its statements.
  const files = await db
    .select()
    .from(fileUploads)
    .where(
      inArray(
        fileUploads.dataSourceConnectionId,
        conns.map((c) => c.id),
      ),
    );

  // Transaction counts per account (one query, group in JS).
  const txCounts = await db
    .select({
      accountId: financeTransactions.accountId,
      id: financeTransactions.id,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, instance.id));
  const perAccount = new Map<string, number>();
  for (const t of txCounts) {
    if (!t.accountId) continue;
    perAccount.set(t.accountId, (perAccount.get(t.accountId) ?? 0) + 1);
  }

  const accounts = accts.map((a) => {
    const ownerConn = a.dataSourceConnectionId
      ? connById.get(a.dataSourceConnectionId)
      : null;
    const plaidConn =
      ownerConn?.dataSourceTypeId === "plaid"
        ? ownerConn
        : conns.find((c) => c.dataSourceTypeId === "plaid" && c.id === a.dataSourceConnectionId);
    const uploadConn = conns.find((c) => c.dataSourceTypeId === "file-upload");

    const statements = files
      .filter((f) => f.accountId === a.id)
      .sort((x, y) => (x.statementPeriodEnd ?? '').localeCompare(y.statementPeriodEnd ?? ''))
      .map((f) => ({
        id: f.id,
        filename: f.originalFilename,
        parseState: f.parseState,
        uploadedAt: f.uploadedAt,
        statementPeriodStart: f.statementPeriodStart,
        statementPeriodEnd: f.statementPeriodEnd,
        transactionCount: f.transactionCount,
      }));

    return {
      id: a.id,
      institutionName: a.institutionName,
      accountLast4: a.accountLast4,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      currentBalance: a.currentBalance ? parseFloat(a.currentBalance) : null,
      availableBalance: a.availableBalance ? parseFloat(a.availableBalance) : null,
      isoCurrencyCode: a.isoCurrencyCode,
      transactionCount: perAccount.get(a.id) ?? 0,
      plaid: plaidConn
        ? {
            connectionId: plaidConn.id,
            displayName: plaidConn.displayName,
            status: plaidConn.status,
            lastSyncedAt: plaidConn.lastSyncedAt,
            requiresReauth: plaidConn.requiresReauth ?? false,
            ingestionState: plaidConn.ingestionState,
          }
        : null,
      upload: statements.length > 0 && uploadConn
        ? {
            connectionId: uploadConn.id,
            statements,
          }
        : null,
    };
  });

  return c.json({ accounts });
});

/**
 * POST /api/finance/resync
 *   Re-runs Plaid ingestion for every active Plaid connection on the caller's
 *   finance agent, then re-categorizes. Useful when Plaid's initial historical
 *   backfill arrived after the onboarding sync (the webhook normally handles
 *   that, but you can also trigger it manually from Devtools).
 *
 *   Returns per-connection sync counts.
 */
app.post("/resync", async (c) => {
  const user = c.get("user");

  const [instance] = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .orderBy(agentInstances.createdAt)
    .limit(1);

  if (!instance) return c.json({ error: "No finance agent found" }, 404);

  const conns = await db
    .select({
      id: dataSourceConnections.id,
      displayName: dataSourceConnections.displayName,
    })
    .from(dataSourceConnections)
    .where(
      and(
        eq(dataSourceConnections.agentInstanceId, instance.id),
        eq(dataSourceConnections.dataSourceTypeId, "plaid"),
        eq(dataSourceConnections.status, "active"),
      ),
    );

  const perConnection: Array<{
    displayName: string | null;
    inserted: number;
    skipped: number;
    accounts: number;
    error?: string;
  }> = [];

  for (const conn of conns) {
    try {
      const result = await ingestPlaidConnection(conn.id);
      perConnection.push({
        displayName: conn.displayName,
        inserted: result.transactionsInserted,
        skipped: result.transactionsSkipped,
        accounts: result.accountsUpserted,
      });
    } catch (err) {
      perConnection.push({
        displayName: conn.displayName,
        inserted: 0,
        skipped: 0,
        accounts: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const categorize = await categorizeAgentInstance(instance.id);
  await backfillOrphans(instance.id);

  return c.json({
    success: true,
    perConnection,
    categorize: {
      clustersAnalyzed: categorize.clustersAnalyzed,
      clustersSkippedCached: categorize.clustersSkippedCached,
      txnsBackfilled: categorize.txnsBackfilled,
    },
  });
});

/**
 * POST /api/finance/wipe
 *   Devtools: nuke all finance data and connections for the caller, including
 *   the agent_instance itself, so the next page load starts onboarding from
 *   zero. Plaid OAuth tokens are deleted (you'll re-link banks).
 *
 *   Returns counts of what was removed.
 */
app.post("/wipe", async (c) => {
  const user = c.get("user");

  const instances = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    );

  if (instances.length === 0) {
    return c.json({
      success: true,
      message: "No finance agent to wipe.",
      removed: {},
    });
  }

  const instanceIds = instances.map((i) => i.id);

  // Order matters: delete children before parents. Most tables cascade from
  // agent_instances, but we delete explicitly so we can return counts.
  const accountsDel = await db
    .delete(financeAccounts)
    .where(inArray(financeAccounts.agentInstanceId, instanceIds))
    .returning({ id: financeAccounts.id });
  const txsDel = await db
    .delete(financeTransactions)
    .where(inArray(financeTransactions.agentInstanceId, instanceIds))
    .returning({ id: financeTransactions.id });
  const clustersDel = await db
    .delete(merchantClusters)
    .where(inArray(merchantClusters.agentInstanceId, instanceIds))
    .returning({ id: merchantClusters.id });
  const briefsDel = await db
    .delete(financeBriefs)
    .where(inArray(financeBriefs.agentInstanceId, instanceIds))
    .returning({ id: financeBriefs.id });
  const financeInsightsDel = await db
    .delete(financeInsights)
    .where(inArray(financeInsights.agentInstanceId, instanceIds))
    .returning({ id: financeInsights.id });
  const platformInsightsDel = await db
    .delete(insights)
    .where(inArray(insights.agentInstanceId, instanceIds))
    .returning({ id: insights.id });
  const uploadsDel = await db
    .delete(fileUploads)
    .where(
      inArray(
        fileUploads.dataSourceConnectionId,
        db
          .select({ id: dataSourceConnections.id })
          .from(dataSourceConnections)
          .where(inArray(dataSourceConnections.agentInstanceId, instanceIds)),
      ),
    )
    .returning({ id: fileUploads.id });
  const connsDel = await db
    .delete(dataSourceConnections)
    .where(inArray(dataSourceConnections.agentInstanceId, instanceIds))
    .returning({ id: dataSourceConnections.id });
  const skillsDel = await db
    .delete(agentInstanceSkills)
    .where(inArray(agentInstanceSkills.agentInstanceId, instanceIds))
    .returning({ id: agentInstanceSkills.id });
  const instancesDel = await db
    .delete(agentInstances)
    .where(inArray(agentInstances.id, instanceIds))
    .returning({ id: agentInstances.id });

  console.log(
    `[finance/wipe] user ${user.id}: removed instance(s) ${instanceIds.join(", ")}`,
  );

  return c.json({
    success: true,
    message: "Finance agent wiped. Refresh to start onboarding fresh.",
    removed: {
      agentInstances: instancesDel.length,
      connections: connsDel.length,
      accounts: accountsDel.length,
      transactions: txsDel.length,
      merchantClusters: clustersDel.length,
      briefs: briefsDel.length,
      financeInsights: financeInsightsDel.length,
      platformInsights: platformInsightsDel.length,
      fileUploads: uploadsDel.length,
      agentInstanceSkills: skillsDel.length,
    },
  });
});

export default app;
