import { Hono } from "hono";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { shareService } from "../platform/chat/share-service";

/**
 * Public, no-auth router. Mounted at /api/shares — exposes only the
 * read-by-token endpoint. The /share/<token> page on the web hits this.
 */
export function createPublicShareRoutes() {
  const app = new Hono();

  // GET /api/shares/:token — returns the frozen snapshot, or 404/410.
  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    if (!/^[A-Za-z0-9]{8,32}$/.test(token)) {
      return c.json({ error: "Invalid token" }, 400);
    }

    const view = await shareService.getPublicShare(token);
    if (!view) {
      // Return 404 for both "never existed" and "revoked" — don't leak
      // existence vs. revocation to the public reader.
      return c.json({ error: "Share not found or revoked" }, 404);
    }
    return c.json(view);
  });

  return app;
}

/**
 * Owner-only router. Mounted at /api/me/shares behind clerkAuth.
 * Create / list / revoke.
 */
export function createOwnerShareRoutes() {
  const app = new Hono();
  app.use("/*", clerkAuth);

  // POST /api/me/shares — create a snapshot of a conversation
  app.post("/", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as {
      conversationId?: unknown;
      showOwnerName?: unknown;
    };

    if (typeof body.conversationId !== "string") {
      return c.json({ error: "conversationId is required" }, 400);
    }
    const showOwnerName =
      typeof body.showOwnerName === "boolean" ? body.showOwnerName : true;

    try {
      const share = await shareService.createShare({
        userId: user.id,
        conversationId: body.conversationId,
        showOwnerName,
      });
      return c.json({ share });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to share";
      if (msg === "Conversation not found" || msg === "Not your conversation") {
        return c.json({ error: msg }, 404);
      }
      if (msg === "Cannot share an empty conversation") {
        return c.json({ error: msg }, 400);
      }
      console.error("[shares] create failed:", err);
      return c.json({ error: msg }, 500);
    }
  });

  // GET /api/me/shares — list my non-revoked shares
  app.get("/", async (c) => {
    const user = c.get("user");
    const shares = await shareService.listShares(user.id);
    return c.json({ shares });
  });

  // DELETE /api/me/shares/:token — revoke
  app.delete("/:token", async (c) => {
    const user = c.get("user");
    const token = c.req.param("token");
    const ok = await shareService.revokeShare({ userId: user.id, token });
    if (!ok) return c.json({ error: "Share not found" }, 404);
    return c.body(null, 204);
  });

  return app;
}
