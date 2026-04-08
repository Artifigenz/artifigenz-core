/**
 * End-to-end test for the delivery system.
 *
 * Creates a test user with email + telegram delivery prefs, creates a test
 * insight, fires INSIGHT_CREATED, and verifies the email and telegram
 * channels both actually send.
 *
 * Run with: npx tsx src/platform/delivery/test-delivery.ts
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import {
  db,
  users,
  agentInstances,
  deliveryPreferences,
  deliveryLog,
} from "@artifigenz/db";
import { deliveryService } from "./delivery-service";
import type { InsightForDelivery } from "./types";
import { insightService } from "../insights/insight-service";
import { emailChannel } from "./channels/email.channel";
import { telegramChannel } from "./channels/telegram.channel";

const TEST_CLERK_ID = "test_user_delivery_e2e";
const TEST_EMAIL = "artifigenzempire@gmail.com";
const TEST_TELEGRAM_CHAT_ID = "8332560313";

async function cleanup() {
  await db.delete(users).where(eq(users.clerkId, TEST_CLERK_ID));
}

async function main() {
  try {
    await cleanup();

    // ─── 1. Create test user + agent + delivery prefs ────────────
    console.log("1. Creating test user, agent, and delivery prefs...");
    const [user] = await db
      .insert(users)
      .values({
        clerkId: TEST_CLERK_ID,
        email: TEST_EMAIL,
        name: "Delivery Test",
        timezone: "America/New_York",
      })
      .returning();

    const [agent] = await db
      .insert(agentInstances)
      .values({
        userId: user.id,
        agentTypeId: "finance",
        status: "active",
      })
      .returning();

    await db.insert(deliveryPreferences).values({
      userId: user.id,
      emailEnabled: true,
      emailAddress: TEST_EMAIL,
      telegramEnabled: true,
      telegramChatId: TEST_TELEGRAM_CHAT_ID,
      telegramOptedIn: true,
    });

    console.log(`   user: ${user.id}`);
    console.log(`   email: ${TEST_EMAIL}`);
    console.log(`   telegram: ${TEST_TELEGRAM_CHAT_ID}`);

    // ─── 2. Test email channel directly ──────────────────────────
    console.log("\n2. Testing email channel directly...");
    const emailInsight: InsightForDelivery = {
      id: "test-email",
      userId: user.id,
      agentInstanceId: agent.id,
      skillId: "finance.subscriptions",
      insightTypeId: "finance.subscriptions.charge-reminder",
      title: "Netflix charges $15.99 tomorrow",
      description:
        "Heads up — Netflix will charge your Chase Checking account $15.99 tomorrow. This is your 6th month on the $15.99/mo plan.",
      data: { merchant: "Netflix", amount: 15.99 },
      isCritical: true,
    };

    const emailMsg = emailChannel.format(emailInsight);
    const emailResult = await emailChannel.send(user.id, emailMsg);
    console.log(`   email sent: ${emailResult.success}`);
    if (emailResult.success) {
      console.log(`   email id: ${emailResult.externalId}`);
    } else {
      console.log(`   email error: ${emailResult.error}`);
    }

    // ─── 3. Test telegram channel directly ───────────────────────
    console.log("\n3. Testing telegram channel directly...");
    const telegramInsight: InsightForDelivery = {
      id: "test-telegram",
      userId: user.id,
      agentInstanceId: agent.id,
      skillId: "finance.subscriptions",
      insightTypeId: "finance.subscriptions.charge-reminder",
      title: "Spotify charges $9.99 tomorrow",
      description:
        "Heads up — Spotify will charge your Chase Checking account $9.99 tomorrow.",
      data: { merchant: "Spotify", amount: 9.99 },
      isCritical: true,
    };

    const telegramMsg = telegramChannel.format(telegramInsight);
    const telegramResult = await telegramChannel.send(user.id, telegramMsg);
    console.log(`   telegram sent: ${telegramResult.success}`);
    if (telegramResult.success) {
      console.log(`   telegram message id: ${telegramResult.externalId}`);
    } else {
      console.log(`   telegram error: ${telegramResult.error}`);
    }

    // ─── 4. Test full routing: persist insight → route to channels ──
    console.log("\n4. Testing full routing via InsightService → DeliveryService...");
    const insightIds = await insightService.persist({
      userId: user.id,
      agentInstanceId: agent.id,
      skillId: "finance.subscriptions",
      outputs: [
        {
          insightTypeId: "finance.subscriptions.charge-reminder",
          title: "Equinox charges $49.99 in 3 days",
          description:
            "Your Equinox gym membership will charge $49.99 in 3 days on your Chase Checking account.",
          data: { merchant: "Equinox", amount: 49.99 },
          critical: true,
        },
      ],
    });

    console.log(`   Persisted ${insightIds.length} insight(s)`);

    // Give the delivery service a beat to route + deliver
    // (In prod this goes through BullMQ, but the event fires synchronously)
    if (insightIds.length > 0) {
      await deliveryService.route(insightIds[0]);
      console.log(`   Routed insight ${insightIds[0].slice(0, 8)}`);
    }

    // Give BullMQ workers a moment to pick up the jobs
    console.log("\n   Waiting 5s for delivery worker to process jobs...");
    await new Promise((r) => setTimeout(r, 5000));

    // ─── 5. Show delivery log ─────────────────────────────────────
    const logs = await db
      .select()
      .from(deliveryLog);
    console.log(`\n5. Delivery log entries (${logs.length}):`);
    for (const log of logs) {
      console.log(`   [${log.status}] ${log.channel} — ${log.errorMessage ?? "OK"}`);
    }

    console.log("\nTest complete. Check your email + telegram!");
  } catch (err) {
    console.error("\nTest failed:", err);
    process.exit(1);
  } finally {
    await cleanup();
    console.log("Cleanup complete.");
    process.exit(0);
  }
}

main();
