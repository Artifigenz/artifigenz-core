import { eq, and, desc, sql, count } from "drizzle-orm";
import { db, insights } from "@artifigenz/db";
import { createHash } from "node:crypto";
import { eventBus } from "../events/event-bus";
import { INSIGHT_CREATED } from "../events/event-types";
import type { InsightOutput } from "../registry/types";
import type { FeedOptions, InsightFeedPage } from "./types";

export class InsightService {
  async persist(params: {
    userId: string;
    agentInstanceId: string;
    skillId: string;
    outputs: InsightOutput[];
  }): Promise<string[]> {
    const ids: string[] = [];

    for (const output of params.outputs) {
      const contentHash = createHash("sha256")
        .update(JSON.stringify(output.data))
        .digest("hex")
        .slice(0, 64);

      const [inserted] = await db
        .insert(insights)
        .values({
          userId: params.userId,
          agentInstanceId: params.agentInstanceId,
          skillId: params.skillId,
          insightTypeId: output.insightTypeId,
          title: output.title,
          description: output.description,
          data: output.data,
          isCritical: output.critical,
          contentHash,
        })
        .onConflictDoNothing()
        .returning({ id: insights.id });

      if (inserted) {
        ids.push(inserted.id);

        eventBus.emit(INSIGHT_CREATED, {
          insightId: inserted.id,
          userId: params.userId,
          agentInstanceId: params.agentInstanceId,
          insightTypeId: output.insightTypeId,
          critical: output.critical,
        });
      }
    }

    return ids;
  }

  async markRead(insightId: string): Promise<void> {
    await db
      .update(insights)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(insights.id, insightId));
  }

  async markAllRead(userId: string): Promise<void> {
    await db
      .update(insights)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(insights.userId, userId), eq(insights.isRead, false)));
  }

  async getFeed(options: FeedOptions): Promise<InsightFeedPage> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [eq(insights.userId, options.userId)];

    if (options.unreadOnly) {
      conditions.push(eq(insights.isRead, false));
    }
    if (options.skillId) {
      conditions.push(eq(insights.skillId, options.skillId));
    }

    const where = and(...conditions);

    const [rows, [unreadResult]] = await Promise.all([
      db
        .select()
        .from(insights)
        .where(where)
        .orderBy(desc(insights.createdAt))
        .limit(limit + 1)
        .offset(offset),
      db
        .select({ count: count() })
        .from(insights)
        .where(
          and(eq(insights.userId, options.userId), eq(insights.isRead, false)),
        ),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      insights: items as unknown as InsightFeedPage["insights"],
      unreadCount: unreadResult?.count ?? 0,
      pagination: { page, limit, hasMore },
    };
  }

  async getById(insightId: string) {
    const [row] = await db
      .select()
      .from(insights)
      .where(eq(insights.id, insightId))
      .limit(1);
    return row ?? null;
  }
}

export const insightService = new InsightService();
