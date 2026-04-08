import { Worker } from "bullmq";
import { getRedisConnection } from "../queues";
import { SkillExecutor } from "../../execution/skill-executor";
import type { AgentRegistry } from "../../registry/agent-registry";

export function createSkillWorker(registry: AgentRegistry) {
  const executor = new SkillExecutor(registry);

  return new Worker(
    "skill_execution",
    async (job) => {
      const { agentInstanceId, skillId } = job.data;
      console.log(`[SkillWorker] Running skill "${skillId}" for instance "${agentInstanceId}"`);

      const result = await executor.execute({ agentInstanceId, skillId });
      console.log(`[SkillWorker] Produced ${result.insightIds.length} insights`);

      return result;
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    },
  );
}
