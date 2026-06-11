import { eq, sql } from "drizzle-orm";
import { db, insightTypes, skills } from "@artifigenz/db";
import { AgentRegistry } from "./platform/registry/agent-registry";
import { register as registerFinance } from "./agents/finance";
import { register as registerHealth } from "./agents/health";

const registry = new AgentRegistry();

export function bootstrapAgents(): AgentRegistry {
  registerFinance(registry);
  registerHealth(registry);

  // Sync the in-memory registry's skill metadata into the `skills`
  // catalog table so agent_instance_skills FKs resolve. Idempotent —
  // ON CONFLICT DO NOTHING means re-runs are safe and previously seeded
  // rows aren't disturbed.
  syncSkillsCatalog().catch((err) => {
    console.warn("[Bootstrap] Skill catalog sync failed:", err);
  });

  // Run async data fixes (fire and forget - don't block startup)
  runDataFixes().catch((err) => {
    console.warn("[Bootstrap] Data fixes failed:", err);
  });

  return registry;
}

async function syncSkillsCatalog() {
  const all = registry.getAllAgentTypes();
  const skillRows = all.flatMap((agent) =>
    agent.skills.map((skill) => ({
      id: skill.id,
      agentTypeId: skill.agentTypeId,
      name: skill.name,
      description: skill.description,
      triggerSchedule: skill.triggers.schedule ?? null,
      triggerEvents: skill.triggers.events ?? null,
      isActive: true,
    })),
  );
  if (skillRows.length > 0) {
    await db.insert(skills).values(skillRows).onConflictDoNothing();
    console.log(
      `[Bootstrap] Skill catalog synced (${skillRows.length} skill(s))`,
    );
  }

  // The insights table FKs into insight_types — keep that catalog in
  // sync too so InsightService.persist() doesn't choke on a new type id.
  const typeRows = all.flatMap((agent) =>
    agent.skills.flatMap((skill) =>
      skill.insightTypes.map((t) => ({
        id: t.id,
        skillId: skill.id,
        name: t.name,
        description: null,
        isCritical: t.critical,
        deliveryChannels: t.deliveryChannels,
      })),
    ),
  );
  if (typeRows.length > 0) {
    // Upsert so changes to deliveryChannels / criticality in code take
    // effect on next boot. Without this, a row inserted with an older
    // channel set stays frozen because ON CONFLICT DO NOTHING ignores it.
    for (const row of typeRows) {
      await db
        .insert(insightTypes)
        .values(row)
        .onConflictDoUpdate({
          target: insightTypes.id,
          set: {
            name: row.name,
            isCritical: row.isCritical,
            deliveryChannels: row.deliveryChannels,
          },
        });
    }
    console.log(
      `[Bootstrap] Insight types synced (${typeRows.length} type(s))`,
    );
  }
}

async function runDataFixes() {
  // Fix: Ensure welcome insight type has email in delivery channels
  await db
    .update(insightTypes)
    .set({ deliveryChannels: ["in_app", "email"] })
    .where(eq(insightTypes.id, "finance.subscriptions.welcome"));

  console.log("[Bootstrap] Data fixes applied");
}
