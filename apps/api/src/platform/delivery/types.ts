export interface FormattedMessage {
  subject?: string;
  body: string;
  bodyHtml?: string;
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
