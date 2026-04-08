import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, deliveryPreferences } from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";

const app = new Hono();
app.use("/*", clerkAuth);

// GET /api/me/delivery
app.get("/", async (c) => {
  const user = c.get("user");
  const [prefs] = await db
    .select()
    .from(deliveryPreferences)
    .where(eq(deliveryPreferences.userId, user.id))
    .limit(1);

  if (!prefs) {
    return c.json({
      email: { enabled: false, address: null },
      whatsapp: { enabled: false, number: null },
      telegram: { enabled: false, chatId: null },
    });
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

export default app;
