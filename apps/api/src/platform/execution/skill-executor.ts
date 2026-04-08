import { eq } from "drizzle-orm";
import { db, agentInstances, agentInstanceSkills, users } from "@artifigenz/db";
import { AgentRegistry } from "../registry/agent-registry";
import { insightService } from "../insights/insight-service";
import { buildExecutionContext } from "./execution-context";

export class SkillExecutor {
  constructor(private registry: AgentRegistry) {}

  async execute(params: {
    agentInstanceId: string;
    skillId: string;
  }): Promise<{ insightIds: string[] }> {
    // Load agent instance
    const [instance] = await db
      .select()
      .from(agentInstances)
      .where(eq(agentInstances.id, params.agentInstanceId))
      .limit(1);

    if (!instance) {
      throw new Error(`Agent instance ${params.agentInstanceId} not found`);
    }

    // Load user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, instance.userId))
      .limit(1);

    if (!user) {
      throw new Error(`User ${instance.userId} not found`);
    }

    // Get skill definition from registry
    const skill = this.registry.getSkill(instance.agentTypeId, params.skillId);
    if (!skill) {
      throw new Error(
        `Skill "${params.skillId}" not found for agent type "${instance.agentTypeId}"`,
      );
    }

    // Build execution context
    const ctx = buildExecutionContext({
      agentInstance: {
        id: instance.id,
        userId: instance.userId,
        agentTypeId: instance.agentTypeId,
        goal: instance.goal,
      },
      user: {
        id: user.id,
        email: user.email,
        timezone: user.timezone ?? "UTC",
      },
      skillId: params.skillId,
    });

    // Run the skill
    const outputs = await skill.analyze(ctx);

    // Persist insights
    const insightIds = await insightService.persist({
      userId: instance.userId,
      agentInstanceId: instance.id,
      skillId: params.skillId,
      outputs,
    });

    // Update last run timestamp
    await db
      .update(agentInstanceSkills)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(agentInstanceSkills.agentInstanceId, params.agentInstanceId));

    await db
      .update(agentInstances)
      .set({ lastAnalyzedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentInstances.id, params.agentInstanceId));

    return { insightIds };
  }
}
