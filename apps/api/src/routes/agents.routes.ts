import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import {
  db,
  agentInstances,
  agentInstanceSkills,
  dataSourceConnections,
} from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { eventBus } from "../platform/events/event-bus";
import { AGENT_ACTIVATED } from "../platform/events/event-types";
import type { AgentRegistry } from "../platform/registry/agent-registry";

export function createAgentRoutes(registry: AgentRegistry) {
  const app = new Hono();
  app.use("/*", clerkAuth);

  // GET /api/agents — Agent catalog
  app.get("/", (c) => {
    const types = registry.getAllAgentTypes();
    return c.json(
      types.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        icon: t.icon,
        skills: t.skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
        })),
        dataSources: t.dataSources.map((ds) => ({
          typeId: ds.typeId,
          name: ds.name,
          description: ds.description,
          connectionFlow: ds.connectionFlow,
        })),
      })),
    );
  });

  // GET /api/agents/:agentTypeId — Single agent type
  app.get("/:agentTypeId", (c) => {
    const type = registry.getAgentType(c.req.param("agentTypeId"));
    if (!type) return c.json({ error: "Agent type not found" }, 404);
    return c.json(type);
  });

  // POST /api/me/agents/:agentTypeId/activate — Create agent instance
  app.post("/me/:agentTypeId/activate", async (c) => {
    const user = c.get("user");
    const agentTypeId = c.req.param("agentTypeId");

    if (!registry.getAgentType(agentTypeId)) {
      return c.json({ error: "Agent type not found" }, 404);
    }

    const body = await c.req.json().catch(() => ({}));

    // status defaults to 'active'; pass status: 'onboarding' to create
    // a hidden instance for use during the activation wizard
    const status = body.status === "onboarding" ? "onboarding" : "active";

    const [instance] = await db
      .insert(agentInstances)
      .values({
        userId: user.id,
        agentTypeId,
        status,
        goal: body.goal ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!instance) {
      return c.json({ error: "Agent already activated" }, 409);
    }

    // Auto-enable all skills for this agent type
    const skills = registry.getSkillsForAgent(agentTypeId);
    if (skills.length > 0) {
      await db.insert(agentInstanceSkills).values(
        skills.map((s) => ({
          agentInstanceId: instance.id,
          skillId: s.id,
        })),
      );
    }

    eventBus.emit(AGENT_ACTIVATED, {
      agentInstanceId: instance.id,
      userId: user.id,
      agentTypeId,
    });

    return c.json({ agentInstance: instance }, 201);
  });

  // GET /api/me/agents — User's agent instances
  app.get("/me/instances", async (c) => {
    const user = c.get("user");

    const instances = await db
      .select()
      .from(agentInstances)
      .where(eq(agentInstances.userId, user.id));

    return c.json(instances);
  });

  // GET /api/me/agents/:agentInstanceId — Single instance
  app.get("/me/instances/:agentInstanceId", async (c) => {
    const user = c.get("user");
    const [instance] = await db
      .select()
      .from(agentInstances)
      .where(
        and(
          eq(agentInstances.id, c.req.param("agentInstanceId")),
          eq(agentInstances.userId, user.id),
        ),
      )
      .limit(1);

    if (!instance) return c.json({ error: "Not found" }, 404);
    return c.json(instance);
  });

  // PATCH /api/me/agents/:agentInstanceId — Update agent
  app.patch("/me/instances/:agentInstanceId", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.goal !== undefined) updates.goal = body.goal;
    if (body.status !== undefined) updates.status = body.status;

    const [updated] = await db
      .update(agentInstances)
      .set(updates)
      .where(
        and(
          eq(agentInstances.id, c.req.param("agentInstanceId")),
          eq(agentInstances.userId, user.id),
        ),
      )
      .returning();

    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json({ agentInstance: updated });
  });

  // DELETE /api/me/agents/:agentInstanceId
  app.delete("/me/instances/:agentInstanceId", async (c) => {
    const user = c.get("user");
    await db
      .delete(agentInstances)
      .where(
        and(
          eq(agentInstances.id, c.req.param("agentInstanceId")),
          eq(agentInstances.userId, user.id),
        ),
      );
    return c.body(null, 204);
  });

  // GET /api/me/agents/:agentInstanceId/skills
  app.get("/me/instances/:agentInstanceId/skills", async (c) => {
    const skills = await db
      .select()
      .from(agentInstanceSkills)
      .where(
        eq(agentInstanceSkills.agentInstanceId, c.req.param("agentInstanceId")),
      );
    return c.json(skills);
  });

  // PATCH /api/me/agents/:agentInstanceId/skills/:skillId
  app.patch(
    "/me/instances/:agentInstanceId/skills/:skillId",
    async (c) => {
      const body = await c.req.json();
      const [updated] = await db
        .update(agentInstanceSkills)
        .set({ isEnabled: body.enabled, updatedAt: new Date() })
        .where(
          and(
            eq(
              agentInstanceSkills.agentInstanceId,
              c.req.param("agentInstanceId"),
            ),
            eq(agentInstanceSkills.skillId, c.req.param("skillId")),
          ),
        )
        .returning();

      if (!updated) return c.json({ error: "Not found" }, 404);
      return c.json({ skill: updated });
    },
  );

  return app;
}
