import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db, agentInstances, users } from "@artifigenz/db";
import { getRedisConnection } from "../queues";
import { runBriefGeneration } from "../../../agents/finance/brief/orchestrator";
import { runSubscriptionRadar } from "../../../agents/finance/skills/subscription-radar";
import { randomUUID } from "node:crypto";

/**
 * Daily full brief regeneration for all eligible users.
 *
 * "Eligible" = onboarding done, has an active finance agent instance.
 */
export function createBriefRefreshWorker() {
  return new Worker(
    "brief_refresh",
    async (job) => {
      const rows = await db
        .select({
          userId: users.id,
          agentInstanceId: agentInstances.id,
        })
        .from(agentInstances)
        .innerJoin(users, eq(users.id, agentInstances.userId))
        .where(
          and(
            eq(agentInstances.agentTypeId, "finance"),
            eq(agentInstances.status, "active"),
            eq(users.onboardingCompleted, true),
          ),
        );

      const jobName = job.name;
      let succeeded = 0;
      let failed = 0;

      for (const { userId, agentInstanceId } of rows) {
        try {
          // Full regeneration — insert a new brief row with fresh LLM call.
          // generation_id is unused here (no SSE subscriber), but the
          // orchestrator still emits into its Map; the entry expires via TTL.
          await runBriefGeneration(userId, agentInstanceId, randomUUID());

          // Run skill jobs (insights generation)
          await runSubscriptionRadar(userId, agentInstanceId);

          succeeded += 1;
        } catch (err) {
          failed += 1;
          console.error(
            `[BriefRefresh] ${jobName} failed for user ${userId}:`,
            err,
          );
        }
      }

      console.log(
        `[BriefRefresh] ${jobName}: ${succeeded} ok, ${failed} failed`,
      );
      return { succeeded, failed };
    },
    {
      connection: getRedisConnection(),
      concurrency: 1, // one job at a time — each job fans out internally
    },
  );
}
