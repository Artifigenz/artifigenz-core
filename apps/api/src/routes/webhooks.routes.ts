import { Hono } from "hono";
import { eq, and, gt } from "drizzle-orm";
import { Webhook } from "svix";
import { db, users, deliveryPreferences } from "@artifigenz/db";
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

// POST /api/webhooks/telegram — Telegram bot webhook
app.post("/telegram", async (c) => {
  const body = await c.req.json();

  // Telegram sends updates with message object
  const message = body.message;
  if (!message || !message.text || !message.chat?.id) {
    return c.json({ received: true });
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();

  // Handle /start <token> command
  if (text.startsWith("/start ")) {
    const token = text.slice(7).trim();

    if (!token || token.length !== 64) {
      await sendTelegramMessage(chatId, "Invalid link. Please generate a new connection link from the Artifigenz settings page.");
      return c.json({ received: true });
    }

    // Find user with this token that hasn't expired
    const [prefs] = await db
      .select()
      .from(deliveryPreferences)
      .where(
        and(
          eq(deliveryPreferences.telegramLinkToken, token),
          gt(deliveryPreferences.telegramLinkTokenExpiresAt, new Date())
        )
      )
      .limit(1);

    if (!prefs) {
      await sendTelegramMessage(chatId, "This link has expired. Please generate a new connection link from the Artifigenz settings page.");
      return c.json({ received: true });
    }

    // Store chat_id and clear the token
    await db
      .update(deliveryPreferences)
      .set({
        telegramChatId: chatId,
        telegramOptedIn: true,
        telegramLinkToken: null,
        telegramLinkTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(deliveryPreferences.userId, prefs.userId));

    await sendTelegramMessage(chatId, "Your Telegram is now connected to Artifigenz! You'll receive notifications here when enabled.");
    return c.json({ received: true });
  }

  // Handle plain /start command (no token)
  if (text === "/start") {
    await sendTelegramMessage(chatId, "Welcome to Artifigenz! To connect your account, click the 'Connect Telegram' button in your settings at app.artifigenz.com/settings");
    return c.json({ received: true });
  }

  return c.json({ received: true });
});

async function sendTelegramMessage(chatId: string, text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("[Telegram] TELEGRAM_BOT_TOKEN not configured");
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("[Telegram] Failed to send message:", err);
  }
}

export default app;
