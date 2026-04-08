import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, users } from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";

const app = new Hono();

// All routes require auth
app.use("/*", clerkAuth);

// GET /api/me — User profile
app.get("/", async (c) => {
  const user = c.get("user");
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    locale: user.locale,
    currency: user.currency,
    onboardingCompleted: user.onboardingCompleted,
  });
});

// PATCH /api/me — Update profile
app.patch("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const allowed = ["timezone", "locale", "currency", "onboardingCompleted"] as const;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates[key] = body[key];
    }
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, user.id))
    .returning();

  return c.json({ user: updated });
});

// DELETE /api/me — Delete account
app.delete("/", async (c) => {
  const user = c.get("user");
  await db.delete(users).where(eq(users.id, user.id));
  return c.body(null, 204);
});

export default app;
