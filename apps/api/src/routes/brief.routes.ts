import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, agentInstances, financeBriefs } from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import {
  createGeneration,
  isClosed,
  subscribe,
  type BriefEvent,
} from "../agents/finance/brief/events";
import { runBriefGeneration } from "../agents/finance/brief/orchestrator";
import { SkillExecutor } from "../platform/execution/skill-executor";
import { AgentRegistry } from "../platform/registry/agent-registry";
import { register as registerFinance } from "../agents/finance";

// Skill executor for running insights after brief generation
const registry = new AgentRegistry();
registerFinance(registry);
const skillExecutor = new SkillExecutor(registry);

const app = new Hono();
app.use("/*", clerkAuth);

/**
 * POST /api/brief/generate
 *   body: { }                   — user is from Clerk session
 *   returns: { generation_id }
 *
 * Kicks off the four-phase pipeline asynchronously. The caller subscribes to
 * /generate/:id/events to receive progress and completion. Spec §3.1.
 */
app.post("/generate", async (c) => {
  const user = c.get("user");

  // Use the user's finance agent instance. If none exists, refuse — onboarding
  // must have created one.
  const [instance] = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    )
    .limit(1);

  if (!instance) {
    return c.json(
      { error: "No finance agent found. Complete onboarding first." },
      400,
    );
  }

  const generationId = randomUUID();
  createGeneration(generationId);

  // Fire-and-forget. The Promise keeps running after we return the response.
  runBriefGeneration(user.id, instance.id, generationId)
    .then(async () => {
      // After brief completes, run the subscriptions skill to refresh insights
      try {
        await skillExecutor.execute({
          agentInstanceId: instance.id,
          skillId: "finance.subscriptions",
        });
      } catch (err) {
        console.error(`[Brief] Skill execution failed for ${generationId}:`, err);
      }
    })
    .catch((err) => {
      console.error(`[Brief] Orchestrator crashed for ${generationId}:`, err);
    });

  return c.json({ generation_id: generationId });
});

/**
 * GET /api/brief/generate/:id/events
 *   Server-sent events. Emits { type, ... } frames matching BriefEvent.
 *   Closes the stream on complete/error/insufficient_data.
 *
 * Auth is via Bearer token on the request. Native EventSource can't send
 * headers, so the frontend consumes this via fetch() + ReadableStream.
 */
app.get("/generate/:id/events", async (c) => {
  const generationId = c.req.param("id");

  return streamSSE(c, async (stream) => {
    // If the generation already completed before the subscriber connected,
    // subscribe() will flush whatever was buffered and we'll see the terminal
    // event immediately.
    await new Promise<void>((resolve) => {
      const unsubscribe = subscribe(generationId, (event: BriefEvent) => {
        // Write then (if terminal) close.
        stream
          .writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          })
          .then(() => {
            if (
              event.type === "complete" ||
              event.type === "error" ||
              event.type === "insufficient_data"
            ) {
              unsubscribe();
              resolve();
            }
          })
          .catch((err) => {
            console.error("[Brief/sse] write failed:", err);
            unsubscribe();
            resolve();
          });
      });

      // If closed before we attached (e.g. user reconnects after terminal),
      // subscribe() will have already flushed the buffered terminal event.
      if (isClosed(generationId)) {
        unsubscribe();
        resolve();
      }
    });
  });
});

interface DigestSnapshot {
  income_monthly?: number;
  recurring_monthly?: number;
  expenses_monthly?: number;
  leftover_monthly?: number;
  outflow_streams?: Array<{
    merchant: string;
    amount_monthly: number;
    frequency: string;
  }>;
}

interface FinanceSummary {
  income: number;
  outflow: number;
  leftover: number;
  breakdown: Array<{
    id: string;
    label: string;
    sublabel: string;
    amount: number;
    count?: number;
  }>;
}

function computeSummary(digest: DigestSnapshot | null): FinanceSummary {
  const defaultSummary: FinanceSummary = {
    income: 0,
    outflow: 0,
    leftover: 0,
    breakdown: [],
  };

  if (!digest) return defaultSummary;

  const streams = digest.outflow_streams ?? [];

  // Categorize streams
  const subscriptionKeywords = [
    'netflix', 'spotify', 'hulu', 'disney', 'amazon prime', 'apple', 'google',
    'youtube', 'hbo', 'paramount', 'peacock', 'adobe', 'microsoft', 'dropbox',
    'slack', 'zoom', 'notion', 'figma', 'canva', 'openai', 'claude', 'gym',
    'fitness', 'planet fitness', 'audible', 'kindle', 'playstation', 'xbox',
    'nintendo', 'twitch', 'patreon', 'substack', 'medium', 'linkedin',
  ];
  const loanKeywords = ['loan', 'mortgage', 'emi', 'car payment', 'auto', 'student', 'lending', 'credit'];
  const rentKeywords = ['rent', 'apartment', 'landlord', 'property', 'housing', 'lease'];
  const utilityKeywords = ['hydro', 'electric', 'gas', 'water', 'internet', 'phone', 'mobile', 'utility'];

  let subscriptionTotal = 0, subscriptionCount = 0;
  let loanTotal = 0, loanCount = 0;
  let otherRecurringTotal = 0;

  for (const stream of streams) {
    const name = (stream.merchant ?? '').toLowerCase();
    const amount = Math.abs(stream.amount_monthly);

    if (subscriptionKeywords.some(kw => name.includes(kw)) || amount < 50) {
      subscriptionTotal += amount;
      subscriptionCount++;
    } else if (loanKeywords.some(kw => name.includes(kw))) {
      loanTotal += amount;
      loanCount++;
    } else if (rentKeywords.some(kw => name.includes(kw)) || utilityKeywords.some(kw => name.includes(kw))) {
      otherRecurringTotal += amount;
    } else {
      otherRecurringTotal += amount;
    }
  }

  const income = digest.income_monthly ?? 0;
  const outflow = digest.expenses_monthly ?? (subscriptionTotal + loanTotal + otherRecurringTotal);
  const leftover = digest.leftover_monthly ?? (income - outflow);

  const breakdown: FinanceSummary['breakdown'] = [];

  if (subscriptionCount > 0) {
    breakdown.push({
      id: 'subscriptions',
      label: 'Subscriptions',
      sublabel: `${subscriptionCount} active`,
      amount: subscriptionTotal,
      count: subscriptionCount,
    });
  }

  if (loanCount > 0) {
    breakdown.push({
      id: 'loans',
      label: 'Loans & EMI',
      sublabel: `${loanCount} ${loanCount === 1 ? 'line' : 'lines'}`,
      amount: loanTotal,
      count: loanCount,
    });
  }

  if (otherRecurringTotal > 0) {
    breakdown.push({
      id: 'other',
      label: 'Other recurring',
      sublabel: 'rent, utilities, autopay',
      amount: otherRecurringTotal,
    });
  }

  return { income, outflow, leftover, breakdown };
}

/**
 * GET /api/brief/current
 *   Returns the latest Brief for the signed-in user, or 404 if none exists.
 *   Spec §3.8.
 */
app.get("/current", async (c) => {
  const user = c.get("user");

  const [row] = await db
    .select()
    .from(financeBriefs)
    .where(eq(financeBriefs.userId, user.id))
    .orderBy(desc(financeBriefs.generatedAt))
    .limit(1);

  if (!row) return c.json({ error: "No brief yet" }, 404);

  const digest = row.digestSnapshot as DigestSnapshot | null;
  const summary = computeSummary(digest);

  return c.json({
    id: row.id,
    verdict: row.verdict,
    numbers: row.numbers,
    paragraph: row.paragraph,
    summary,
    data_scope: row.dataScope,
    generated_at: row.generatedAt,
  });
});

/**
 * GET /api/brief/breakdown
 *   Returns detailed breakdown of all recurring streams for the signed-in user,
 *   categorized by type, with individual items and calculation explanations.
 */
app.get("/breakdown", async (c) => {
  const user = c.get("user");

  // Get the user's finance agent instance
  const [instance] = await db
    .select({ id: agentInstances.id })
    .from(agentInstances)
    .where(
      and(
        eq(agentInstances.userId, user.id),
        eq(agentInstances.agentTypeId, "finance"),
      ),
    );

  if (!instance) {
    return c.json({ error: "No finance agent found" }, 404);
  }

  // Get the latest brief for totals
  const [brief] = await db
    .select()
    .from(financeBriefs)
    .where(eq(financeBriefs.userId, user.id))
    .orderBy(desc(financeBriefs.generatedAt))
    .limit(1);

  if (!brief) {
    return c.json({ error: "No brief yet" }, 404);
  }

  // Get all recurring streams from the database
  const { financeRecurringStreams, financeAccounts, dataSourceConnections } = await import("@artifigenz/db");

  const streams = await db
    .select()
    .from(financeRecurringStreams)
    .where(eq(financeRecurringStreams.agentInstanceId, instance.id));

  const accounts = await db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, instance.id));

  // Get all connections for diagnostics
  const connections = await db
    .select()
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.agentInstanceId, instance.id));

  // Build account lookup map for showing account names
  const accountMap = new Map(accounts.map(a => [a.plaidAccountId, a]));

  interface StreamItem {
    id: string;
    merchantName: string;
    description: string | null;
    amount: number;
    frequency: string;
    lastDate: string | null;
    nextDate: string | null;
    accountId: string | null;
    accountName: string | null;
    accountMask: string | null;
    category: 'subscription' | 'loan' | 'other' | 'transfer';
    pfcPrimary: string | null;
  }

  const incomeItems: StreamItem[] = [];        // True income (PFC = INCOME)
  const transfersInItems: StreamItem[] = [];   // Inbound transfers (not income)
  const transfersOutItems: StreamItem[] = [];  // Outbound transfers (not expenses)
  const subscriptionItems: StreamItem[] = [];  // Subscriptions (PFC-based)
  const loanItems: StreamItem[] = [];          // Loan payments (PFC-based)
  const otherItems: StreamItem[] = [];         // Other recurring expenses

  // Plaid PFC categories for subscriptions/entertainment
  const subscriptionPFCs = [
    'ENTERTAINMENT',
    'GENERAL_SERVICES',  // Often includes subscriptions
  ];

  // Plaid PFC categories for loans
  const loanPFCs = [
    'LOAN_PAYMENTS',
  ];

  // Plaid PFC categories for transfers (should be excluded from expenses)
  const transferPFCs = [
    'TRANSFER_OUT',
    'TRANSFER_IN',
  ];

  for (const stream of streams) {
    const amount = Math.abs(Number(stream.averageAmount));
    const pfcPrimary = (stream as { pfcPrimary?: string | null }).pfcPrimary ?? null;
    const account = stream.plaidAccountId ? accountMap.get(stream.plaidAccountId) : null;

    const item: StreamItem = {
      id: stream.id,
      merchantName: stream.merchantName ?? stream.description ?? 'Unknown',
      description: stream.description,
      amount,
      frequency: stream.frequency,
      lastDate: stream.lastDate,
      nextDate: stream.predictedNextDate,
      accountId: stream.plaidAccountId,
      accountName: account?.name ?? null,
      accountMask: account?.mask ?? null,
      category: 'other',
      pfcPrimary,
    };

    if (stream.direction === 'inflow') {
      // Only count as income if PFC is INCOME (salary, wages, freelance)
      // Everything else (TRANSFER_IN, BANK_FEES, etc.) goes to transfers
      if (pfcPrimary === 'INCOME') {
        incomeItems.push(item);
      } else {
        transfersInItems.push(item);
      }
    } else {
      // Categorize outflow using Plaid's PFC
      if (transferPFCs.includes(pfcPrimary ?? '')) {
        // Internal transfers - don't count as expenses
        item.category = 'transfer';
        transfersOutItems.push(item);
      } else if (loanPFCs.includes(pfcPrimary ?? '')) {
        // Loan payments
        item.category = 'loan';
        loanItems.push(item);
      } else if (subscriptionPFCs.includes(pfcPrimary ?? '')) {
        // Entertainment/subscriptions by PFC
        item.category = 'subscription';
        subscriptionItems.push(item);
      } else {
        // Everything else is "other recurring"
        // This includes RENT_AND_UTILITIES, TRANSPORTATION, FOOD_AND_DRINK, etc.
        otherItems.push(item);
      }
    }
  }

  // Normalize to monthly
  function normalizeToMonthly(amount: number, frequency: string): number {
    switch (frequency.toUpperCase()) {
      case 'WEEKLY': return amount * 52 / 12;
      case 'BIWEEKLY': return amount * 26 / 12;
      case 'SEMI_MONTHLY': return amount * 2;
      case 'MONTHLY': return amount;
      case 'ANNUALLY': return amount / 12;
      default: return amount;
    }
  }

  // Calculate totals (transfers are excluded from expenses)
  const incomeTotal = incomeItems.reduce((sum, i) => sum + normalizeToMonthly(i.amount, i.frequency), 0);
  const subscriptionTotal = subscriptionItems.reduce((sum, i) => sum + normalizeToMonthly(i.amount, i.frequency), 0);
  const loanTotal = loanItems.reduce((sum, i) => sum + normalizeToMonthly(i.amount, i.frequency), 0);
  const otherTotal = otherItems.reduce((sum, i) => sum + normalizeToMonthly(i.amount, i.frequency), 0);
  const transfersOutTotal = transfersOutItems.reduce((sum, i) => sum + normalizeToMonthly(i.amount, i.frequency), 0);
  // Recurring total excludes transfers (they're not real expenses)
  const recurringTotal = subscriptionTotal + loanTotal + otherTotal;

  // Get expenses from digest
  const digest = brief.digestSnapshot as DigestSnapshot | null;
  const expensesMonthly = digest?.expenses_monthly ?? recurringTotal;

  return c.json({
    generatedAt: brief.generatedAt,
    accounts: accounts.map(a => ({
      id: a.id,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      currentBalance: Number(a.currentBalance),
      availableBalance: Number(a.availableBalance),
      currency: a.isoCurrencyCode,
    })),
    income: {
      total: Math.round(incomeTotal * 100) / 100,
      items: incomeItems.map(i => ({
        ...i,
        monthlyAmount: Math.round(normalizeToMonthly(i.amount, i.frequency) * 100) / 100,
      })),
    },
    transfersIn: {
      total: Math.round(transfersInItems.reduce((sum, i) => sum + normalizeToMonthly(i.amount, i.frequency), 0) * 100) / 100,
      count: transfersInItems.length,
      items: transfersInItems.map(i => ({
        ...i,
        monthlyAmount: Math.round(normalizeToMonthly(i.amount, i.frequency) * 100) / 100,
      })),
    },
    transfersOut: {
      total: Math.round(transfersOutTotal * 100) / 100,
      count: transfersOutItems.length,
      items: transfersOutItems.map(i => ({
        ...i,
        monthlyAmount: Math.round(normalizeToMonthly(i.amount, i.frequency) * 100) / 100,
      })),
    },
    subscriptions: {
      total: Math.round(subscriptionTotal * 100) / 100,
      count: subscriptionItems.length,
      items: subscriptionItems.map(i => ({
        ...i,
        monthlyAmount: Math.round(normalizeToMonthly(i.amount, i.frequency) * 100) / 100,
      })),
    },
    loans: {
      total: Math.round(loanTotal * 100) / 100,
      count: loanItems.length,
      items: loanItems.map(i => ({
        ...i,
        monthlyAmount: Math.round(normalizeToMonthly(i.amount, i.frequency) * 100) / 100,
      })),
    },
    other: {
      total: Math.round(otherTotal * 100) / 100,
      count: otherItems.length,
      items: otherItems.map(i => ({
        ...i,
        monthlyAmount: Math.round(normalizeToMonthly(i.amount, i.frequency) * 100) / 100,
      })),
    },
    totals: {
      income: Math.round(incomeTotal * 100) / 100,
      recurringOutflow: Math.round(recurringTotal * 100) / 100,
      totalExpenses: Math.round(expensesMonthly * 100) / 100,
      variableSpend: Math.round((expensesMonthly - recurringTotal) * 100) / 100,
      leftover: Math.round((incomeTotal - expensesMonthly) * 100) / 100,
    },
    // Diagnostic info to debug connection issues
    diagnostics: {
      connections: connections.map(conn => {
        const meta = conn.metadata as { institutionName?: string } | null;
        const connAccounts = accounts.filter(a =>
          (conn.metadata as { accounts?: Array<{ id: string }> })?.accounts?.some(ca => ca.id === a.plaidAccountId)
        );
        const connStreams = streams.filter(s => connAccounts.some(a => a.plaidAccountId === s.plaidAccountId));
        return {
          id: conn.id,
          institution: meta?.institutionName ?? 'Unknown',
          status: conn.status,
          accountCount: connAccounts.length,
          streamCount: connStreams.length,
          lastSynced: conn.lastSyncedAt,
        };
      }),
      totalStreams: streams.length,
      streamsByAccount: accounts.map(a => ({
        account: `${a.name} ••${a.mask}`,
        streams: streams.filter(s => s.plaidAccountId === a.plaidAccountId).length,
      })),
    },
  });
});

export default app;
