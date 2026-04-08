import { eq } from "drizzle-orm";
import { db, deliveryPreferences } from "@artifigenz/db";
import type { DeliveryChannel } from "./channel.interface";
import type { FormattedMessage, DeliveryResult, InsightForDelivery } from "../types";

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

export const telegramChannel: DeliveryChannel = {
  id: "telegram",

  format(insight: InsightForDelivery): FormattedMessage {
    // Telegram supports simple HTML: <b>, <i>, <a>, etc.
    const title = `<b>${escapeHtml(insight.title)}</b>`;
    const description = insight.description ? `\n\n${escapeHtml(insight.description)}` : "";
    const body = `${title}${description}`;

    return { body };
  },

  async send(userId: string, message: FormattedMessage): Promise<DeliveryResult> {
    const [prefs] = await db
      .select()
      .from(deliveryPreferences)
      .where(eq(deliveryPreferences.userId, userId))
      .limit(1);

    if (!prefs?.telegramEnabled || !prefs.telegramChatId) {
      return { success: false, error: "Telegram not enabled or chat_id missing" };
    }

    try {
      const token = getBotToken();
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: prefs.telegramChatId,
            text: message.body,
            parse_mode: "HTML",
          }),
        },
      );

      const data = (await response.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };

      if (!data.ok) {
        return { success: false, error: data.description ?? "Telegram API error" };
      }

      return { success: true, externalId: String(data.result?.message_id ?? "") };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async verifyConnection(userId: string): Promise<boolean> {
    const [prefs] = await db
      .select()
      .from(deliveryPreferences)
      .where(eq(deliveryPreferences.userId, userId))
      .limit(1);
    return Boolean(prefs?.telegramEnabled && prefs.telegramChatId);
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
