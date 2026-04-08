import { createMiddleware } from "hono/factory";
import { verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { db, users } from "@artifigenz/db";

type UserRow = typeof users.$inferSelect;

declare module "hono" {
  interface ContextVariableMap {
    user: UserRow;
    clerkUserId: string;
  }
}

export const clerkAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    const clerkId = payload.sub;
    c.set("clerkUserId", clerkId);

    // Look up user in our database
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (!user) {
      return c.json({ error: "User not found. Complete onboarding first." }, 404);
    }

    c.set("user", user);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});
