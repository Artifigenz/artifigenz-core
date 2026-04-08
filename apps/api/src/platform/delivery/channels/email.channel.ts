import { Resend } from "resend";
import { eq } from "drizzle-orm";
import { db, deliveryPreferences } from "@artifigenz/db";
import type { DeliveryChannel } from "./channel.interface";
import type { FormattedMessage, DeliveryResult, InsightForDelivery } from "../types";

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  resendClient = new Resend(key);
  return resendClient;
}

const FROM_EMAIL = process.env.EMAIL_FROM ?? "Artifigenz <onboarding@resend.dev>";

export const emailChannel: DeliveryChannel = {
  id: "email",

  format(insight: InsightForDelivery): FormattedMessage {
    const subject = insight.title;
    const body = `${insight.description ?? ""}\n\n— Artifigenz`;
    const bodyHtml = `
      <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="font-size: 18px; margin: 0 0 16px; color: #111;">${escapeHtml(insight.title)}</h2>
        <p style="font-size: 14px; line-height: 1.6; color: #333; margin: 0 0 24px;">
          ${escapeHtml(insight.description ?? "")}
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="font-size: 12px; color: #999; margin: 0;">
          Sent from your Artifigenz agent.
        </p>
      </div>
    `.trim();

    return { subject, body, bodyHtml };
  },

  async send(userId: string, message: FormattedMessage): Promise<DeliveryResult> {
    const [prefs] = await db
      .select()
      .from(deliveryPreferences)
      .where(eq(deliveryPreferences.userId, userId))
      .limit(1);

    if (!prefs?.emailEnabled || !prefs.emailAddress) {
      return { success: false, error: "Email not enabled or address missing" };
    }

    try {
      const resend = getResend();
      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: prefs.emailAddress,
        subject: message.subject ?? "Artifigenz update",
        text: message.body,
        html: message.bodyHtml,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, externalId: data?.id };
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
    return Boolean(prefs?.emailEnabled && prefs.emailAddress);
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
