import { eq, sql } from "drizzle-orm";
import { db, insightTypes } from "@artifigenz/db";
import { AgentRegistry } from "./platform/registry/agent-registry";
import { register as registerFinance } from "./agents/finance";
import { register as registerHealth } from "./agents/health";

const registry = new AgentRegistry();

export function bootstrapAgents(): AgentRegistry {
  registerFinance(registry);
  registerHealth(registry);

  // Run async data fixes (fire and forget - don't block startup)
  runDataFixes().catch((err) => {
    console.warn("[Bootstrap] Data fixes failed:", err);
  });

  return registry;
}

async function runDataFixes() {
  // Fix: Ensure welcome insight type has email in delivery channels
  await db
    .update(insightTypes)
    .set({ deliveryChannels: ["in_app", "email"] })
    .where(eq(insightTypes.id, "finance.subscriptions.welcome"));

  console.log("[Bootstrap] Data fixes applied");
}
