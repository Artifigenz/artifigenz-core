import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { db, deliveryLog } from "@artifigenz/db";
import { getRedisConnection } from "../queues";

export function createDeliveryWorker() {
  return new Worker(
    "delivery",
    async (job) => {
      const { insightId, userId, channel, message } = job.data;

      console.log(
        `[DeliveryWorker] Sending "${channel}" delivery for insight "${insightId}"`,
      );

      try {
        // Channel implementations will be added in Phase 3
        // For now, log the delivery attempt
        await db.insert(deliveryLog).values({
          insightId,
          channel,
          status: "sent",
          attemptCount: 1,
          sentAt: new Date(),
        });

        console.log(`[DeliveryWorker] Delivered via ${channel}`);
        return { status: "sent" };
      } catch (error) {
        await db.insert(deliveryLog).values({
          insightId,
          channel,
          status: "failed",
          attemptCount: (job.attemptsMade || 0) + 1,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        });

        throw error;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 10,
    },
  );
}
