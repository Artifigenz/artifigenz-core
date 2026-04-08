import { Hono } from "hono";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { insightService } from "../platform/insights/insight-service";

const app = new Hono();
app.use("/*", clerkAuth);

// GET /api/me/insights — Unified feed
app.get("/", async (c) => {
  const user = c.get("user");
  const query = c.req.query();

  const feed = await insightService.getFeed({
    userId: user.id,
    page: query.page ? parseInt(query.page) : 1,
    limit: query.limit ? parseInt(query.limit) : 20,
    unreadOnly: query.unreadOnly === "true",
    agentTypeId: query.agentTypeId,
    skillId: query.skillId,
  });

  return c.json(feed);
});

// GET /api/me/insights/:insightId
app.get("/:insightId", async (c) => {
  const insight = await insightService.getById(c.req.param("insightId"));
  if (!insight) return c.json({ error: "Not found" }, 404);
  return c.json(insight);
});

// PATCH /api/me/insights/:insightId/read
app.patch("/:insightId/read", async (c) => {
  await insightService.markRead(c.req.param("insightId"));
  return c.body(null, 204);
});

// POST /api/me/insights/read-all
app.post("/read-all", async (c) => {
  const user = c.get("user");
  await insightService.markAllRead(user.id);
  return c.body(null, 204);
});

export default app;
