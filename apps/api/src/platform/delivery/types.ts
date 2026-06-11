export interface FormattedMessage {
  subject?: string;
  body: string;
  bodyHtml?: string;
  // Optional Telegram inline keyboard. Email/web ignore it.
  inlineKeyboard?: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
  text: string;
  // External URL (the "View on web", "Reconnect" actions).
  url?: string;
  // Callback payload — Telegram pings the bot when tapped. Use this for
  // actions like "Mark read" that we want to handle in-app.
  callback_data?: string;
}

export interface DeliveryResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export interface InsightForDelivery {
  id: string;
  userId: string;
  agentInstanceId: string;
  skillId: string;
  insightTypeId: string;
  title: string;
  description: string | null;
  data: Record<string, unknown>;
  isCritical: boolean;
}
