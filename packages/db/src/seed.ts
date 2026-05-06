import { db } from "./client";
import { agentTypes, skills, dataSourceTypes, agentTypeDataSources, insightTypes } from "./schema";

async function seed() {
  console.log("Seeding database...\n");

  // ─── Agent Types ────────────────────────────────────────────────

  await db
    .insert(agentTypes)
    .values([
      {
        id: "finance",
        name: "Finance",
        description: "Watches your money. Finds patterns. Delivers insights.",
        icon: "wallet",
        isActive: true,
      },
      {
        id: "travel",
        name: "Travel",
        description: "Plans trips you'd never have time to research.",
        icon: "plane",
        isActive: false,
      },
      {
        id: "health",
        name: "Health",
        description: "Notices patterns in your habits before you do.",
        icon: "heart",
        isActive: false,
      },
      {
        id: "learning",
        name: "Learning",
        description: "Turns your curiosity into structured progress.",
        icon: "book",
        isActive: false,
      },
    ])
    .onConflictDoNothing();

  console.log("  Agent types seeded");

  // ─── Skills ─────────────────────────────────────────────────────

  await db
    .insert(skills)
    .values([
      {
        id: "finance.subscriptions",
        agentTypeId: "finance",
        name: "Subscriptions",
        description: "Discovers, tracks, and analyzes recurring charges across all your accounts.",
        triggerSchedule: "0 8 * * *",
        triggerEvents: ["data_source.synced"],
        isActive: true,
      },
      {
        id: "subscription-radar",
        agentTypeId: "finance",
        name: "Subscription Radar",
        description: "Daily subscription monitoring: upcoming charges, new subscriptions, price changes, and charge confirmations.",
        triggerSchedule: "0 2 * * *",
        triggerEvents: ["brief.generated"],
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  console.log("  Skills seeded");

  // ─── Data Source Types ──────────────────────────────────────────

  await db
    .insert(dataSourceTypes)
    .values([
      {
        id: "plaid",
        name: "Bank Account (Plaid)",
        description: "Connect your bank accounts securely via Plaid",
        connectionFlow: "sdk",
        syncMechanism: "webhook",
      },
      {
        id: "file-upload",
        name: "Bank Statement Upload",
        description: "Upload bank statements (PDF, CSV, Excel) for analysis",
        connectionFlow: "file_upload",
        syncMechanism: "manual",
      },
    ])
    .onConflictDoNothing();

  console.log("  Data source types seeded");

  // ─── Agent Type <-> Data Source mapping ─────────────────────────

  await db
    .insert(agentTypeDataSources)
    .values([
      { agentTypeId: "finance", dataSourceTypeId: "plaid" },
      { agentTypeId: "finance", dataSourceTypeId: "file-upload" },
    ])
    .onConflictDoNothing();

  console.log("  Agent-data source mappings seeded");

  // ─── Insight Types ──────────────────────────────────────────────

  await db
    .insert(insightTypes)
    .values([
      {
        id: "finance.subscriptions.visibility",
        skillId: "finance.subscriptions",
        name: "Subscription Overview",
        description: "Summary of all detected subscriptions",
        isCritical: false,
        deliveryChannels: ["in_app"],
      },
      {
        id: "finance.subscriptions.charge-reminder",
        skillId: "finance.subscriptions",
        name: "Charge Reminder",
        description: "Upcoming subscription charge alert",
        isCritical: true,
        deliveryChannels: ["in_app", "email", "whatsapp", "telegram"],
      },
      {
        id: "finance.subscriptions.price-change",
        skillId: "finance.subscriptions",
        name: "Price Change Detected",
        description: "A subscription price has changed",
        isCritical: true,
        deliveryChannels: ["in_app", "email"],
      },
      {
        id: "finance.subscriptions.new-detected",
        skillId: "finance.subscriptions",
        name: "New Subscription Detected",
        description: "A new recurring charge has been identified",
        isCritical: false,
        deliveryChannels: ["in_app", "email"],
      },
      {
        id: "finance.subscriptions.duplicate",
        skillId: "finance.subscriptions",
        name: "Duplicate Subscription",
        description: "Possible duplicate or overlapping subscriptions found",
        isCritical: false,
        deliveryChannels: ["in_app", "email"],
      },
      {
        id: "finance.subscriptions.summary",
        skillId: "finance.subscriptions",
        name: "Subscription Summary",
        description: "Weekly/monthly subscription spending summary",
        isCritical: false,
        deliveryChannels: ["in_app", "email"],
      },
      // Subscription Radar skill insight types
      {
        id: "subscription-radar.upcoming",
        skillId: "subscription-radar",
        name: "Upcoming Charge",
        description: "A subscription is charging today",
        isCritical: false,
        deliveryChannels: ["in_app"],
      },
      {
        id: "subscription-radar.new",
        skillId: "subscription-radar",
        name: "New Subscription",
        description: "A new recurring charge pattern has been detected",
        isCritical: false,
        deliveryChannels: ["in_app", "email"],
      },
      {
        id: "subscription-radar.price-change",
        skillId: "subscription-radar",
        name: "Price Change",
        description: "A subscription charged a different amount than expected",
        isCritical: true,
        deliveryChannels: ["in_app", "email"],
      },
      {
        id: "subscription-radar.charged",
        skillId: "subscription-radar",
        name: "Charged as Expected",
        description: "A subscription charged at its usual amount",
        isCritical: false,
        deliveryChannels: ["in_app"],
      },
    ])
    .onConflictDoNothing();

  console.log("  Insight types seeded");

  console.log("\nSeed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
