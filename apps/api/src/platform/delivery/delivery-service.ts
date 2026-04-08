import { eq } from "drizzle-orm";
import { db, insights, insightTypes, deliveryPreferences } from "@artifigenz/db";
import { deliveryQueue } from "../scheduling/queues";
import { emailChannel } from "./channels/email.channel";
import { telegramChannel } from "./channels/telegram.channel";
import type { DeliveryChannel } from "./channels/channel.interface";
import type { InsightForDelivery } from "./types";

const CHANNELS: Record<string, DeliveryChannel> = {
  email: emailChannel,
  telegram: telegramChannel,
  // whatsapp: whatsappChannel, // Not implemented for MVP
};

export class DeliveryService {
  /**
   * Routes an insight to all applicable channels based on:
   * 1. The insight type's configured deliveryChannels
   * 2. The user's delivery preferences (which channels are enabled)
   *
   * Queues delivery jobs for each matching channel.
   * In-app delivery is free (the insight is already in the DB).
   */
  async route(insightId: string): Promise<void> {
    // Load the insight + its type config
    const [row] = await db
      .select({
        insight: insights,
        typeConfig: insightTypes,
      })
      .from(insights)
      .leftJoin(insightTypes, eq(insights.insightTypeId, insightTypes.id))
      .where(eq(insights.id, insightId))
      .limit(1);

    if (!row) {
      console.warn(`[DeliveryService] Insight ${insightId} not found`);
      return;
    }

    const { insight, typeConfig } = row;
    if (!typeConfig) {
      console.warn(`[DeliveryService] Insight type ${insight.insightTypeId} not found`);
      return;
    }

    // Get allowed channels from insight type config
    const allowedChannels = typeConfig.deliveryChannels ?? [];

    // Get user's enabled channels
    const [prefs] = await db
      .select()
      .from(deliveryPreferences)
      .where(eq(deliveryPreferences.userId, insight.userId))
      .limit(1);

    if (!prefs) return; // User has no delivery prefs = no external delivery

    const userEnabledChannels: string[] = [];
    if (prefs.emailEnabled && prefs.emailAddress) userEnabledChannels.push("email");
    if (prefs.telegramEnabled && prefs.telegramChatId) userEnabledChannels.push("telegram");
    if (prefs.whatsappEnabled && prefs.whatsappNumber) userEnabledChannels.push("whatsapp");

    // Intersect: channels that the insight type allows AND the user has enabled
    const targetChannels = allowedChannels.filter(
      (c) => c !== "in_app" && userEnabledChannels.includes(c),
    );

    if (targetChannels.length === 0) return;

    // Queue a delivery job per channel
    const insightForDelivery: InsightForDelivery = {
      id: insight.id,
      userId: insight.userId,
      agentInstanceId: insight.agentInstanceId,
      skillId: insight.skillId,
      insightTypeId: insight.insightTypeId,
      title: insight.title,
      description: insight.description,
      data: (insight.data ?? {}) as Record<string, unknown>,
      isCritical: insight.isCritical ?? false,
    };

    for (const channelId of targetChannels) {
      await deliveryQueue.add(`deliver-${insight.id}-${channelId}`, {
        insightId: insight.id,
        userId: insight.userId,
        channel: channelId,
        insight: insightForDelivery,
      });
      console.log(
        `[DeliveryService] Queued ${channelId} delivery for insight ${insight.id.slice(0, 8)}`,
      );
    }
  }

  /**
   * Sends an insight directly through a specific channel (bypasses queue).
   * Used by the delivery worker.
   */
  async deliverNow(params: {
    channelId: string;
    userId: string;
    insight: InsightForDelivery;
  }) {
    const channel = CHANNELS[params.channelId];
    if (!channel) {
      throw new Error(`Unknown delivery channel: ${params.channelId}`);
    }
    const message = channel.format(params.insight);
    return channel.send(params.userId, message);
  }
}

export const deliveryService = new DeliveryService();
