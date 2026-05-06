import { eq, and, gte, lte } from "drizzle-orm";
import {
  db,
  financeRecurringStreams,
  financeRecurringSnapshots,
  financeTransactions,
  financeAccounts,
} from "@artifigenz/db";
import { insightService } from "../../../../platform/insights/insight-service";
import { detectUpcoming } from "./jobs/upcoming";
import { detectNew } from "./jobs/new";
import { detectPriceChange } from "./jobs/price-change";
import { detectCharged } from "./jobs/charged";

export interface SubscriptionInsight {
  insightTypeId: string;
  title: string;
  description: string;
  data: Record<string, unknown>;
  critical: boolean;
}

export interface SkillContext {
  userId: string;
  agentInstanceId: string;
  today: string; // ISO date YYYY-MM-DD
}

const SKILL_ID = "subscription-radar";

/**
 * Run the subscription-radar skill.
 * Generates insights about subscriptions: upcoming charges, new subscriptions,
 * price changes, etc.
 */
export async function runSubscriptionRadar(
  userId: string,
  agentInstanceId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const ctx: SkillContext = { userId, agentInstanceId, today };

  // Fetch current recurring streams
  const streams = await db
    .select()
    .from(financeRecurringStreams)
    .where(
      and(
        eq(financeRecurringStreams.agentInstanceId, agentInstanceId),
        eq(financeRecurringStreams.direction, "outflow"),
      ),
    );

  // Fetch accounts for card info
  const accounts = await db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, agentInstanceId));

  const accountMap = new Map(accounts.map((a) => [a.plaidAccountId, a]));

  // Fetch yesterday's transactions for price change / charged detection
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const recentTransactions = await db
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.agentInstanceId, agentInstanceId),
        gte(financeTransactions.transactionDate, yesterdayStr),
        lte(financeTransactions.transactionDate, today),
      ),
    );

  // Fetch previous snapshot for new subscription detection
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  const [previousSnapshot] = await db
    .select()
    .from(financeRecurringSnapshots)
    .where(
      and(
        eq(financeRecurringSnapshots.agentInstanceId, agentInstanceId),
        lte(financeRecurringSnapshots.snapshotDate, sevenDaysAgoStr),
      ),
    )
    .orderBy(financeRecurringSnapshots.snapshotDate)
    .limit(1);

  // Run all detection jobs
  const insights: SubscriptionInsight[] = [];

  // 1. Upcoming charges (charging today)
  const upcoming = detectUpcoming(streams, accountMap, today);
  insights.push(...upcoming);

  // 2. New subscriptions (not in previous snapshot)
  const newSubs = detectNew(streams, previousSnapshot?.streams as unknown[] ?? [], accountMap);
  insights.push(...newSubs);

  // 3. Price changes (yesterday's charge differs from stream average)
  const priceChanges = detectPriceChange(streams, recentTransactions, accountMap);
  insights.push(...priceChanges);

  // 4. Charged as expected (confirmation of regular charges)
  const charged = detectCharged(streams, recentTransactions, accountMap);
  insights.push(...charged);

  // Store insights using the platform insight service
  if (insights.length > 0) {
    await insightService.persist({
      userId,
      agentInstanceId,
      skillId: SKILL_ID,
      outputs: insights,
    });
  }

  // Save today's snapshot for future diffing
  await db
    .insert(financeRecurringSnapshots)
    .values({
      agentInstanceId,
      snapshotDate: today,
      streams: streams as unknown as Record<string, unknown>[],
    })
    .onConflictDoUpdate({
      target: [
        financeRecurringSnapshots.agentInstanceId,
        financeRecurringSnapshots.snapshotDate,
      ],
      set: {
        streams: streams as unknown as Record<string, unknown>[],
      },
    });

  console.log(
    `[SubscriptionRadar] Generated ${insights.length} insights for user ${userId}`,
  );
}
