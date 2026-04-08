import { eq, and } from "drizzle-orm";
import { db, agentInstances, agentInstanceSkills } from "@artifigenz/db";
import { skillExecutionQueue } from "./queues";
import { eventBus } from "../events/event-bus";
import { DATA_SOURCE_SYNCED } from "../events/event-types";
import type { AgentRegistry } from "../registry/agent-registry";

export class Scheduler {
  constructor(private registry: AgentRegistry) {}

  async start(): Promise<void> {
    await this.registerCronJobs();
    this.registerEventHandlers();
    console.log("[Scheduler] Started");
  }

  private async registerCronJobs(): Promise<void> {
    // Get all active agent instances with their skills
    const instances = await db
      .select()
      .from(agentInstances)
      .where(eq(agentInstances.status, "active"));

    for (const instance of instances) {
      const skills = this.registry.getSkillsForAgent(instance.agentTypeId);

      for (const skill of skills) {
        if (skill.triggers.schedule) {
          await skillExecutionQueue.upsertJobScheduler(
            `cron-${instance.id}-${skill.id}`,
            { pattern: skill.triggers.schedule },
            {
              data: {
                agentInstanceId: instance.id,
                skillId: skill.id,
              },
            },
          );

          console.log(
            `[Scheduler] Registered cron "${skill.triggers.schedule}" for skill "${skill.id}" on instance "${instance.id}"`,
          );
        }
      }
    }
  }

  private registerEventHandlers(): void {
    // When data source syncs, trigger skills that listen to that event
    eventBus.on(DATA_SOURCE_SYNCED, async (payload) => {
      const instance = await db
        .select()
        .from(agentInstances)
        .where(eq(agentInstances.id, payload.agentInstanceId))
        .then((rows) => rows[0]);

      if (!instance) return;

      const skills = this.registry.getSkillsForAgent(instance.agentTypeId);

      for (const skill of skills) {
        if (skill.triggers.events?.includes(DATA_SOURCE_SYNCED)) {
          await skillExecutionQueue.add(`event-${skill.id}`, {
            agentInstanceId: payload.agentInstanceId,
            skillId: skill.id,
          });

          console.log(
            `[Scheduler] Queued skill "${skill.id}" from event "${DATA_SOURCE_SYNCED}"`,
          );
        }
      }
    });
  }
}
