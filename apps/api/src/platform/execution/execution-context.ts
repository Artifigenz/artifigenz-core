import { eq, and } from "drizzle-orm";
import { db, agentInstanceSkills, contextFacts, contextObservations, contextStated, contextBehavioral } from "@artifigenz/db";
import type { SkillExecutionContext, DataQuery, UnifiedContext } from "./types";

export function buildExecutionContext(params: {
  agentInstance: SkillExecutionContext["agentInstance"];
  user: SkillExecutionContext["user"];
  skillId: string;
}): SkillExecutionContext {
  const { agentInstance, user, skillId } = params;

  return {
    agentInstance,
    user,
    userGoal: agentInstance.goal,

    async getData<T>(query: DataQuery): Promise<T[]> {
      // Dynamic query against agent-specific tables
      // Each agent's data tables are queried directly in skill implementations
      // This is a pass-through — skills use it to access their own data
      const result = await db.execute(
        `SELECT * FROM ${query.table} WHERE agent_instance_id = $1 ${
          query.orderBy ? `ORDER BY ${query.orderBy}` : ""
        } ${query.limit ? `LIMIT ${query.limit}` : ""}`,
        // @ts-expect-error -- raw SQL params
        [agentInstance.id],
      );
      return result as unknown as T[];
    },

    async getSkillState<T>(): Promise<T | null> {
      const [row] = await db
        .select({ state: agentInstanceSkills.state })
        .from(agentInstanceSkills)
        .where(
          and(
            eq(agentInstanceSkills.agentInstanceId, agentInstance.id),
            eq(agentInstanceSkills.skillId, skillId),
          ),
        )
        .limit(1);
      return (row?.state as T) ?? null;
    },

    async setSkillState<T>(state: T): Promise<void> {
      await db
        .update(agentInstanceSkills)
        .set({ state: state as Record<string, unknown>, updatedAt: new Date() })
        .where(
          and(
            eq(agentInstanceSkills.agentInstanceId, agentInstance.id),
            eq(agentInstanceSkills.skillId, skillId),
          ),
        );
    },

    async getContext(): Promise<UnifiedContext> {
      const [facts, observations, stated, behavioral] = await Promise.all([
        db
          .select()
          .from(contextFacts)
          .where(eq(contextFacts.userId, user.id)),
        db
          .select()
          .from(contextObservations)
          .where(
            and(
              eq(contextObservations.userId, user.id),
              eq(contextObservations.status, "active"),
            ),
          ),
        db
          .select()
          .from(contextStated)
          .where(
            and(
              eq(contextStated.userId, user.id),
              eq(contextStated.active, true),
            ),
          ),
        db
          .select()
          .from(contextBehavioral)
          .where(eq(contextBehavioral.userId, user.id)),
      ]);

      const factsMap: Record<string, unknown> = {};
      for (const f of facts) {
        factsMap[`${f.agentType}.${f.factKey}`] = f.factValue;
      }

      return {
        facts: factsMap,
        observations: observations.map((o) => ({
          text: o.text,
          confidence: o.confidence,
        })),
        stated: stated.map((s) => ({ type: s.type, text: s.text })),
        behavioral: behavioral[0] ?? {},
      };
    },

    async updateFacts(facts: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(facts)) {
        await db
          .insert(contextFacts)
          .values({
            userId: user.id,
            agentType: agentInstance.agentTypeId,
            factKey: key,
            factValue: value as Record<string, unknown>,
          })
          .onConflictDoUpdate({
            target: [contextFacts.userId, contextFacts.agentType, contextFacts.factKey],
            set: { factValue: value as Record<string, unknown>, updatedAt: new Date() },
          });
      }
    },
  };
}
