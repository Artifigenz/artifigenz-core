import type { FormattedMessage, DeliveryResult, InsightForDelivery } from "../types";

export interface DeliveryChannel {
  id: string; // "email", "telegram", "whatsapp"

  /**
   * Format an insight for this channel's medium.
   */
  format(insight: InsightForDelivery): FormattedMessage;

  /**
   * Send a pre-formatted message to a user.
   * Reads the user's delivery preferences to know where to send.
   */
  send(userId: string, message: FormattedMessage): Promise<DeliveryResult>;

  /**
   * Returns true if this channel is properly configured for the user
   * (has required credentials/identifiers set).
   */
  verifyConnection(userId: string): Promise<boolean>;
}
