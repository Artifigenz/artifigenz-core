import { Hono } from "hono";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { db, deliveryPreferences } from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";

const app = new Hono();
app.use("/*", clerkAuth);

// GET /api/me/delivery
app.get("/", async (c) => {
  const user = c.get("user");
  let [prefs] = await db
    .select()
    .from(deliveryPreferences)
    .where(eq(deliveryPreferences.userId, user.id))
    .limit(1);

  // Auto-create delivery preferences with email from Clerk if not exists
  if (!prefs) {
    [prefs] = await db
      .insert(deliveryPreferences)
      .values({
        userId: user.id,
        emailAddress: user.email, // From Clerk
        emailEnabled: false,
      })
      .returning();
  }

  // If email address is missing but user has one in Clerk, update it
  if (!prefs.emailAddress && user.email) {
    [prefs] = await db
      .update(deliveryPreferences)
      .set({ emailAddress: user.email, updatedAt: new Date() })
      .where(eq(deliveryPreferences.userId, user.id))
      .returning();
  }

  return c.json({
    email: { enabled: prefs.emailEnabled, address: prefs.emailAddress },
    whatsapp: { enabled: prefs.whatsappEnabled, number: prefs.whatsappNumber },
    telegram: { enabled: prefs.telegramEnabled, chatId: prefs.telegramChatId },
  });
});

// PATCH /api/me/delivery
app.patch("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.email) {
    if (body.email.enabled !== undefined) updates.emailEnabled = body.email.enabled;
    if (body.email.address !== undefined) updates.emailAddress = body.email.address;
  }
  if (body.whatsapp) {
    if (body.whatsapp.enabled !== undefined) updates.whatsappEnabled = body.whatsapp.enabled;
    if (body.whatsapp.number !== undefined) updates.whatsappNumber = body.whatsapp.number;
  }
  if (body.telegram) {
    if (body.telegram.enabled !== undefined) updates.telegramEnabled = body.telegram.enabled;
    if (body.telegram.chatId !== undefined) updates.telegramChatId = body.telegram.chatId;
  }

  const [prefs] = await db
    .insert(deliveryPreferences)
    .values({ userId: user.id, ...updates })
    .onConflictDoUpdate({
      target: deliveryPreferences.userId,
      set: updates,
    })
    .returning();

  return c.json({ deliveryPreferences: prefs });
});

// POST /api/me/delivery/telegram/link — Generate deep-link token
app.post("/telegram/link", async (c) => {
  const user = c.get("user");

  // Generate a cryptographically secure token
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await db
    .insert(deliveryPreferences)
    .values({
      userId: user.id,
      telegramLinkToken: token,
      telegramLinkTokenExpiresAt: expiresAt,
    })
    .onConflictDoUpdate({
      target: deliveryPreferences.userId,
      set: {
        telegramLinkToken: token,
        telegramLinkTokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      },
    });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "Artifigenz_bot";
  const linkUrl = `https://t.me/${botUsername}?start=${token}`;

  return c.json({ linkUrl, expiresAt: expiresAt.toISOString() });
});

// GET /api/me/delivery/telegram/status — Check connection status
app.get("/telegram/status", async (c) => {
  const user = c.get("user");

  const [prefs] = await db
    .select()
    .from(deliveryPreferences)
    .where(eq(deliveryPreferences.userId, user.id))
    .limit(1);

  if (!prefs) {
    return c.json({ connected: false, linkPending: false });
  }

  const connected = Boolean(prefs.telegramChatId);
  const linkPending =
    Boolean(prefs.telegramLinkToken) &&
    prefs.telegramLinkTokenExpiresAt &&
    new Date(prefs.telegramLinkTokenExpiresAt) > new Date();

  return c.json({ connected, linkPending });
});

export default app;
