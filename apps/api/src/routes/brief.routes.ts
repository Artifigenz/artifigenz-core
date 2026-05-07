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
  outflow_streams?: Array<{
    merchant: string;
    amount_monthly: number;
    frequency: string;
  }>;
}

interface BriefTileItem {
  id: string;
  label: string;
  value: string;
  sublabel?: string;
}

interface BriefTileGroup {
  id: string;
  title: string;
  items: BriefTileItem[];
}

function computeTileGroups(digest: DigestSnapshot | null): BriefTileGroup[] {
  if (!digest) return [];

  const groups: BriefTileGroup[] = [];
  const streams = digest.outflow_streams ?? [];

  // Categorize streams by merchant name patterns
  const subscriptionKeywords = [
    'netflix', 'spotify', 'hulu', 'disney', 'amazon prime', 'apple', 'google',
    'youtube', 'hbo', 'paramount', 'peacock', 'adobe', 'microsoft', 'dropbox',
    'slack', 'zoom', 'notion', 'figma', 'canva', 'openai', 'claude', 'gym',
    'fitness', 'planet fitness', 'audible', 'kindle', 'playstation', 'xbox',
    'nintendo', 'twitch', 'patreon', 'substack', 'medium', 'linkedin',
  ];

  const rentKeywords = ['rent', 'apartment', 'landlord', 'property', 'housing', 'lease'];
  const loanKeywords = ['loan', 'mortgage', 'emi', 'car payment', 'auto', 'student', 'lending', 'credit'];

  let subscriptionTotal = 0;
  let subscriptionCount = 0;
  let rentTotal = 0;
  let loanTotal = 0;
  let loanCount = 0;

  for (const stream of streams) {
    const name = (stream.merchant ?? '').toLowerCase();
    const amount = Math.abs(stream.amount_monthly);

    if (subscriptionKeywords.some(kw => name.includes(kw))) {
      subscriptionTotal += amount;
      subscriptionCount++;
    } else if (rentKeywords.some(kw => name.includes(kw))) {
      rentTotal += amount;
    } else if (loanKeywords.some(kw => name.includes(kw))) {
      loanTotal += amount;
      loanCount++;
    } else if (amount < 100) {
      // Small recurring charges are likely subscriptions
      subscriptionTotal += amount;
      subscriptionCount++;
    }
  }

  // Income group (first)
  if (digest.income_monthly && digest.income_monthly > 0) {
    groups.push({
      id: 'income',
      title: 'Income',
      items: [{
        id: 'income',
        label: 'Monthly',
        value: `$${Math.round(digest.income_monthly).toLocaleString()}`,
      }],
    });
  }

  // Outgoing group
  const outgoingItems: BriefTileItem[] = [];

  // Subscriptions
  if (subscriptionCount > 0) {
    outgoingItems.push({
      id: 'subscriptions',
      label: 'Subscriptions',
      value: `$${subscriptionTotal.toFixed(0)}`,
      sublabel: `${subscriptionCount} active`,
    });
  }

  // Rent
  if (rentTotal > 0) {
    outgoingItems.push({
      id: 'rent',
      label: 'Rent',
      value: `$${rentTotal.toFixed(0)}`,
    });
  }

  // Loans/EMI
  if (loanTotal > 0) {
    outgoingItems.push({
      id: 'loans',
      label: 'Loans & EMI',
      value: `$${loanTotal.toFixed(0)}`,
      sublabel: loanCount > 1 ? `${loanCount} payments` : undefined,
    });
  }

  if (outgoingItems.length > 0) {
    groups.push({
      id: 'outgoing',
      title: 'Monthly Outgoing',
      items: outgoingItems,
    });
  }

  return groups;
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
  const tileGroups = computeTileGroups(digest);

  return c.json({
    id: row.id,
    verdict: row.verdict,
    numbers: row.numbers,
    paragraph: row.paragraph,
    tileGroups,
    data_scope: row.dataScope,
    generated_at: row.generatedAt,
  });
});

export default app;
