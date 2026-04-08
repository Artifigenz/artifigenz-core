import { Worker } from "bullmq";
import { db, deliveryLog } from "@artifigenz/db";
import { getRedisConnection } from "../queues";
import { deliveryService } from "../../delivery/delivery-service";
import type { InsightForDelivery } from "../../delivery/types";

export function createDeliveryWorker() {
  return new Worker(
    "delivery",
    async (job) => {
      const { insightId, userId, channel, insight } = job.data as {
        insightId: string;
        userId: string;
        channel: string;
        insight: InsightForDelivery;
      };

      console.log(
        `[DeliveryWorker] Sending "${channel}" delivery for insight "${insightId.slice(0, 8)}"`,
      );

      const result = await deliveryService.deliverNow({
        channelId: channel,
        userId,
        insight,
      });

      await db.insert(deliveryLog).values({
        insightId,
        channel,
        status: result.success ? "sent" : "failed",
        attemptCount: (job.attemptsMade || 0) + 1,
        errorMessage: result.error ?? null,
        sentAt: result.success ? new Date() : null,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Delivery failed");
      }

      console.log(`[DeliveryWorker] Delivered via ${channel} (${result.externalId ?? "—"})`);
      return { status: "sent", externalId: result.externalId };
    },
    {
      connection: getRedisConnection(),
      concurrency: 10,
    },
  );
}
