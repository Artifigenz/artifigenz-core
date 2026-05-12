import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Webhook } from "svix";
import { db, users } from "@artifigenz/db";
import { plaidAdapter } from "../agents/finance/data-sources/plaid.adapter";
import { ingestPlaidConnection } from "../agents/finance/ingest/plaid-ingest";

const app = new Hono();

// POST /api/webhooks/clerk — Clerk user sync
app.post("/clerk", async (c) => {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  const svixId = c.req.header("svix-id");
  const svixTimestamp = c.req.header("svix-timestamp");
  const svixSignature = c.req.header("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: "Missing Svix headers" }, 400);
  }

  const body = await c.req.text();

  let event: { type: string; data: Record<string, unknown> };
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as typeof event;
  } catch {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }

  const { type, data } = event;

  if (type === "user.created" || type === "user.updated") {
    const clerkId = data.id as string;
    const email =
      (data.email_addresses as Array<{ email_address: string }>)?.[0]
        ?.email_address ?? "";
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ");
    const avatarUrl = data.image_url as string | undefined;

    await db
      .insert(users)
      .values({ clerkId, email, name, avatarUrl })
      .onConflictDoUpdate({
        target: users.clerkId,
        set: { email, name, avatarUrl, updatedAt: new Date() },
      });
  }

  if (type === "user.deleted") {
    const clerkId = data.id as string;
    await db.delete(users).where(eq(users.clerkId, clerkId));
  }

  return c.json({ received: true });
});

// POST /api/webhooks/plaid — Plaid sync trigger.
// Plaid fires SYNC_UPDATES_AVAILABLE as more historical backfill becomes
// available (typically several events over 5-60 min after Link). The adapter
// resolves the connection from item_id; we then call ingestPlaidConnection
// which advances the ingestion state machine.
//
// Categorization is intentionally NOT triggered here — Challenge 1 is
// ingestion-only. Categorization will be wired in when its phase comes.
//
// Signature verification is a TODO — for now we trust Plaid's IPs (signing
// requires a separate setup step).
app.post("/plaid", async (c) => {
  const body = await c.req.json();
  console.log("[Webhook] Plaid event:", body.webhook_type, body.webhook_code, body.item_id);

  try {
    if (!plaidAdapter.handleWebhook) {
      return c.json({ received: true });
    }
    const decision = await plaidAdapter.handleWebhook(body);
    if (decision.action === "sync" && decision.connectionId) {
      const result = await ingestPlaidConnection(decision.connectionId);
      console.log(
        `[Webhook/plaid] synced connection ${decision.connectionId}: +${result.transactionsInserted} new, state=${result.ingestionState}`,
      );
    }
  } catch (err) {
    console.error("[Webhook/plaid] handler failed:", err);
  }

  return c.json({ received: true });
});

// POST /api/webhooks/telegram — Telegram bot webhook (Phase 3)
app.post("/telegram", async (c) => {
  // TODO: Phase 3 — handle user opt-in messages
  return c.json({ received: true });
});

export default app;
