import { and, eq, gte, lte, desc, like, sql } from "drizzle-orm";
import {
  db,
  financeTransactions,
  merchantClusters,
  agentInstances,
} from "@artifigenz/db";
import type { ChatToolDefinition } from "../../../platform/chat/types";

function cadenceToDays(cadence: string | null): number | null {
  switch (cadence) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30;
    case "quarterly":
      return 90;
    case "annual":
      return 365;
    default:
      return null;
  }
}

async function getFinanceAgent(userId: string) {
  const [agent] = await db
    .select()
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, userId),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .limit(1);
  return agent ?? null;
}

export const financeTools: ChatToolDefinition[] = [
  {
    name: "getSubscriptions",
    description: "List all detected subscriptions for the user",
    input_schema: {
      type: "object",
      properties: {
        sortBy: {
          type: "string",
          enum: ["amount", "next_charge", "merchant"],
          description: "Sort order — default 'amount'",
        },
      },
    },
    async execute(input, ctx) {
      const agent = await getFinanceAgent(ctx.user.id);
      if (!agent) return { subscriptions: [] };

      const subs = await db
        .select()
        .from(merchantClusters)
        .where(
          and(
            eq(merchantClusters.agentInstanceId, agent.id),
            eq(merchantClusters.category, "subscription"),
            eq(merchantClusters.isRecurring, true),
          ),
        );

      const withNextCharge = subs.map((s) => {
        const days = cadenceToDays(s.cadence);
        let nextCharge: string | null = null;
        if (s.lastSeenDate && days) {
          const next = new Date(s.lastSeenDate);
          next.setDate(next.getDate() + days);
          nextCharge = next.toISOString().slice(0, 10);
        }
        return {
          merchant: s.displayName ?? s.merchantNormalized,
          amount: Number(s.monthlyAmount ?? 0),
          frequency: s.cadence ?? "irregular",
          lastCharge: s.lastSeenDate,
          nextCharge,
          account: null as string | null,
        };
      });

      const sortBy = (input.sortBy as string) ?? "amount";
      const sorted = [...withNextCharge].sort((a, b) => {
        if (sortBy === "amount") return b.amount - a.amount;
        if (sortBy === "next_charge") {
          return (a.nextCharge ?? "").localeCompare(b.nextCharge ?? "");
        }
        return (a.merchant ?? "").localeCompare(b.merchant ?? "");
      });

      return { subscriptions: sorted, totalCount: sorted.length };
    },
  },

  {
    name: "getUpcomingCharges",
    description:
      "Get subscriptions charging within a date range (default next 7 days)",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days ahead to look" },
      },
    },
    async execute(input, ctx) {
      const agent = await getFinanceAgent(ctx.user.id);
      if (!agent) return { charges: [] };

      const days = (input.days as number) ?? 7;
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date();
      future.setDate(future.getDate() + days);
      const futureStr = future.toISOString().slice(0, 10);

      const subs = await db
        .select()
        .from(merchantClusters)
        .where(
          and(
            eq(merchantClusters.agentInstanceId, agent.id),
            eq(merchantClusters.isRecurring, true),
          ),
        );

      // Predict next charge from last_seen + cadence interval.
      const charges = subs
        .map((s) => {
          const cadenceDays = cadenceToDays(s.cadence);
          if (!s.lastSeenDate || !cadenceDays) return null;
          const next = new Date(s.lastSeenDate);
          next.setDate(next.getDate() + cadenceDays);
          const nextStr = next.toISOString().slice(0, 10);
          if (nextStr < today || nextStr > futureStr) return null;
          return {
            merchant: s.displayName ?? s.merchantNormalized,
            amount: Number(s.monthlyAmount ?? 0),
            date: nextStr,
            account: null as string | null,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        charges,
        totalAmount: charges.reduce((sum, c) => sum + c.amount, 0),
        count: charges.length,
      };
    },
  },

  {
    name: "getTransactions",
    description: "Query transactions by date range, merchant, or category",
    input_schema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date YYYY-MM-DD" },
        endDate: { type: "string", description: "End date YYYY-MM-DD" },
        merchantName: { type: "string", description: "Filter by merchant" },
        category: { type: "string", description: "Filter by category" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
    async execute(input, ctx) {
      const agent = await getFinanceAgent(ctx.user.id);
      if (!agent) return { transactions: [] };

      const conditions = [eq(financeTransactions.agentInstanceId, agent.id)];
      if (input.startDate) {
        conditions.push(
          gte(financeTransactions.transactionDate, input.startDate as string),
        );
      }
      if (input.endDate) {
        conditions.push(
          lte(financeTransactions.transactionDate, input.endDate as string),
        );
      }
      if (input.merchantName) {
        conditions.push(
          like(financeTransactions.merchantName, `%${input.merchantName}%`),
        );
      }
      if (input.category) {
        conditions.push(eq(financeTransactions.category, input.category as string));
      }

      const limit = (input.limit as number) ?? 50;
      const txs = await db
        .select()
        .from(financeTransactions)
        .where(and(...conditions))
        .orderBy(desc(financeTransactions.transactionDate))
        .limit(limit);

      return {
        transactions: txs.map((t) => ({
          date: t.transactionDate,
          merchant: t.merchantName ?? t.description,
          amount: Number(t.amount),
          category: t.category,
          account: t.accountName,
        })),
        count: txs.length,
      };
    },
  },

  {
    name: "getSubscriptionHistory",
    description: "Get charge history for a specific subscription merchant",
    input_schema: {
      type: "object",
      properties: {
        merchantName: { type: "string", description: "Merchant name" },
        months: { type: "number", description: "How many months back (default 6)" },
      },
      required: ["merchantName"],
    },
    async execute(input, ctx) {
      const agent = await getFinanceAgent(ctx.user.id);
      if (!agent) return { history: [] };

      const months = (input.months as number) ?? 6;
      const since = new Date();
      since.setMonth(since.getMonth() - months);
      const sinceStr = since.toISOString().slice(0, 10);

      const txs = await db
        .select()
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.agentInstanceId, agent.id),
            gte(financeTransactions.transactionDate, sinceStr),
            like(
              financeTransactions.merchantName,
              `%${input.merchantName as string}%`,
            ),
          ),
        )
        .orderBy(desc(financeTransactions.transactionDate));

      return {
        history: txs.map((t) => ({
          date: t.transactionDate,
          amount: Number(t.amount),
          account: t.accountName,
        })),
        totalCharged: txs.reduce((sum, t) => sum + Number(t.amount), 0),
        count: txs.length,
      };
    },
  },

  {
    name: "getSpendingSummary",
    description: "Get spending breakdown by category for a period",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["this_month", "last_month", "last_3_months"],
        },
      },
    },
    async execute(input, ctx) {
      const agent = await getFinanceAgent(ctx.user.id);
      if (!agent) return { byCategory: [], total: 0 };

      const period = (input.period as string) ?? "this_month";
      const now = new Date();
      let startDate: Date;
      let endDate: Date = now;

      if (period === "this_month") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (period === "last_month") {
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      }

      const result = await db
        .select({
          category: financeTransactions.category,
          total: sql<string>`SUM(${financeTransactions.amount})`.as("total"),
          count: sql<string>`COUNT(*)`.as("count"),
        })
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.agentInstanceId, agent.id),
            gte(
              financeTransactions.transactionDate,
              startDate.toISOString().slice(0, 10),
            ),
            lte(
              financeTransactions.transactionDate,
              endDate.toISOString().slice(0, 10),
            ),
          ),
        )
        .groupBy(financeTransactions.category);

      const byCategory = result.map((r) => ({
        category: r.category ?? "uncategorized",
        total: Number(r.total),
        count: Number(r.count),
      }));

      const total = byCategory.reduce((sum, c) => sum + c.total, 0);

      return {
        period,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        byCategory: byCategory.sort((a, b) => b.total - a.total),
        total,
      };
    },
  },
];
