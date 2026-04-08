import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Webhook } from "svix";
import { db, users } from "@artifigenz/db";

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

// POST /api/webhooks/plaid — Plaid webhook receiver (Phase 2)
app.post("/plaid", async (c) => {
  // TODO: Phase 2 — verify signature, route to adapter
  const body = await c.req.json();
  console.log("[Webhook] Plaid event:", body.webhook_type, body.webhook_code);
  return c.json({ received: true });
});

// POST /api/webhooks/telegram — Telegram bot webhook (Phase 3)
app.post("/telegram", async (c) => {
  // TODO: Phase 3 — handle user opt-in messages
  return c.json({ received: true });
});

export default app;
