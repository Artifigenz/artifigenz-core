/**
 * End-to-end test for the file upload adapter.
 *
 * Creates a fake CSV bank statement, simulates an upload, runs the adapter's
 * sync() to parse it with Claude, then runs the subscriptions skill.
 *
 * Run with: npx tsx src/agents/finance/test-file-upload.ts
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  users,
  agentInstances,
  agentInstanceSkills,
  financeTransactions,
  financeSubscriptions,
  fileUploads,
  insights,
} from "@artifigenz/db";
import { AgentRegistry } from "../../platform/registry/agent-registry";
import { register as registerFinance } from "./index";
import { SkillExecutor } from "../../platform/execution/skill-executor";
import { fileUploadAdapter } from "./data-sources/file-upload.adapter";

const TEST_CLERK_ID = "test_user_file_upload_e2e";
const FAKE_CSV = `Date,Description,Amount,Balance
2026-03-01,NETFLIX.COM 866-579 CA,15.99,4500.00
2026-03-02,STARBUCKS #12345,5.75,4494.25
2026-03-05,SPOTIFY USA,9.99,4484.26
2026-03-08,AMAZON.COM*MK123,42.99,4441.27
2026-03-12,NYTIMES.COM SUBSCRIPTION,17.00,4424.27
2026-03-15,EQUINOX FITNESS CLUB,49.99,4374.28
2026-03-18,UBER RIDE,12.50,4361.78
2026-02-01,NETFLIX.COM 866-579 CA,15.99,4780.00
2026-02-05,SPOTIFY USA,9.99,4770.01
2026-02-12,NYTIMES.COM SUBSCRIPTION,17.00,4753.01
2026-02-15,EQUINOX FITNESS CLUB,49.99,4703.02
2026-01-01,NETFLIX.COM 866-579 CA,15.99,5100.00
2026-01-05,SPOTIFY USA,9.99,5090.01
2026-01-12,NYTIMES.COM SUBSCRIPTION,17.00,5073.01
2026-01-15,EQUINOX FITNESS CLUB,49.99,5023.02
2025-12-01,NETFLIX.COM 866-579 CA,15.99,5500.00
2025-12-05,SPOTIFY USA,9.99,5490.01
2025-12-12,NYTIMES.COM SUBSCRIPTION,17.00,5473.01
2025-12-15,EQUINOX FITNESS CLUB,49.99,5423.02
2025-11-01,NETFLIX.COM 866-579 CA,15.99,5800.00
2025-11-05,SPOTIFY USA,9.99,5790.01
2025-11-15,EQUINOX FITNESS CLUB,49.99,5740.02
`;

async function cleanup() {
  await db.delete(users).where(eq(users.clerkId, TEST_CLERK_ID));
}

async function main() {
  const tempDir = join(tmpdir(), "artifigenz-test-upload");
  await mkdir(tempDir, { recursive: true });

  try {
    await cleanup();

    // ─── 1. Create test user + agent ──────────────────────────────
    console.log("1. Creating test user + finance agent...");
    const [user] = await db
      .insert(users)
      .values({
        clerkId: TEST_CLERK_ID,
        email: "upload-test@artifigenz.com",
        name: "Upload Test",
        timezone: "America/New_York",
      })
      .returning();

    const [agent] = await db
      .insert(agentInstances)
      .values({
        userId: user.id,
        agentTypeId: "finance",
        status: "active",
        goal: "Find wasted subscriptions",
      })
      .returning();

    await db.insert(agentInstanceSkills).values({
      agentInstanceId: agent.id,
      skillId: "finance.subscriptions",
      isEnabled: true,
    });
    console.log(`   agent: ${agent.id}`);

    // ─── 2. Write fake CSV to disk ───────────────────────────────
    const filename = "fake-statement.csv";
    const filepath = join(tempDir, filename);
    await writeFile(filepath, FAKE_CSV);
    console.log(`\n2. Wrote fake statement to ${filepath}`);
    console.log(`   ${FAKE_CSV.split("\n").length - 2} lines of transactions`);

    // ─── 3. Create connection via adapter ────────────────────────
    console.log("\n3. Creating file-upload connection via adapter...");
    const connection = await fileUploadAdapter.finalizeConnection({
      agentInstanceId: agent.id,
      dataSourceTypeId: "file-upload",
    });
    console.log(`   connection: ${connection.id}`);

    // ─── 4. Create a pending file_uploads row (simulating upload) ─
    console.log("\n4. Creating file_uploads record...");
    const [fileRow] = await db
      .insert(fileUploads)
      .values({
        dataSourceConnectionId: connection.id,
        originalFilename: filename,
        fileType: "csv",
        storagePath: filepath,
        fileSizeBytes: FAKE_CSV.length,
        extractionStatus: "pending",
      })
      .returning();
    console.log(`   file record: ${fileRow.id}`);

    // ─── 5. Run adapter.sync() — parses via Claude ────────────────
    console.log("\n5. Running adapter.sync() (calls Claude API)...");
    const startTime = Date.now();
    await fileUploadAdapter.sync(connection);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Claude parsing took ${elapsed}s`);

    // ─── 6. Verify transactions stored ────────────────────────────
    const storedTxs = await db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.agentInstanceId, agent.id));

    console.log(`\n6. Verified ${storedTxs.length} transactions in DB`);
    console.log(`   Sample:`);
    for (const tx of storedTxs.slice(0, 5)) {
      console.log(
        `     ${tx.transactionDate}  ${tx.merchantName ?? tx.description}  $${tx.amount}  [${tx.category ?? "—"}]`,
      );
    }

    if (storedTxs.length === 0) {
      console.error("\n⚠ No transactions stored — Claude may have failed to parse");
      return;
    }

    // ─── 7. Run subscriptions skill ──────────────────────────────
    console.log("\n7. Running subscriptions skill...");
    const registry = new AgentRegistry();
    registerFinance(registry);
    const executor = new SkillExecutor(registry);
    const result = await executor.execute({
      agentInstanceId: agent.id,
      skillId: "finance.subscriptions",
    });
    console.log(`   Produced ${result.insightIds.length} insights`);

    // ─── 8. Show detected subscriptions ──────────────────────────
    const subs = await db
      .select()
      .from(financeSubscriptions)
      .where(eq(financeSubscriptions.agentInstanceId, agent.id));

    console.log(`\n   Detected ${subs.length} subscriptions:`);
    for (const sub of subs) {
      console.log(
        `     - ${sub.merchantName}: $${sub.amount} ${sub.frequency} (next: ${sub.nextChargeDate})`,
      );
    }

    const createdInsights = await db
      .select()
      .from(insights)
      .where(eq(insights.agentInstanceId, agent.id));
    console.log(`\n   Insights:`);
    for (const insight of createdInsights) {
      console.log(`     [${insight.insightTypeId}] ${insight.title}`);
    }

    console.log("\nTest complete!");
  } catch (err) {
    console.error("\nTest failed:", err);
    process.exit(1);
  } finally {
    await cleanup();
    await rm(tempDir, { recursive: true, force: true });
    console.log("Cleanup complete.");
    process.exit(0);
  }
}

main();
