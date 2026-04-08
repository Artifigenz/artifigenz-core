export interface FeedOptions {
  userId: string;
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
  agentTypeId?: string;
  skillId?: string;
}

export interface InsightFeedPage {
  insights: InsightRow[];
  unreadCount: number;
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface InsightRow {
  id: string;
  userId: string;
  agentInstanceId: string;
  skillId: string;
  insightTypeId: string;
  title: string;
  description: string | null;
  data: Record<string, unknown>;
  isCritical: boolean;
  isRead: boolean;
  contentHash: string | null;
  insightDate: string;
  createdAt: Date;
  readAt: Date | null;
}
