import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, dataSourceConnections } from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { dataSourceSyncQueue } from "../platform/scheduling/queues";
import type { AgentRegistry } from "../platform/registry/agent-registry";

export function createDataSourceRoutes(registry: AgentRegistry) {
  const app = new Hono();
  app.use("/*", clerkAuth);

  // GET /api/me/agents/:agentInstanceId/connections
  app.get("/:agentInstanceId/connections", async (c) => {
    const connections = await db
      .select()
      .from(dataSourceConnections)
      .where(
        eq(
          dataSourceConnections.agentInstanceId,
          c.req.param("agentInstanceId"),
        ),
      );

    return c.json(
      connections.map((conn) => {
        const metadata = (conn.metadata ?? {}) as {
          institutionId?: string;
          institutionName?: string;
          accounts?: Array<{ id: string; name: string; mask?: string }>;
        };
        return {
          id: conn.id,
          dataSourceTypeId: conn.dataSourceTypeId,
          displayName: conn.displayName,
          status: conn.status,
          lastSyncedAt: conn.lastSyncedAt,
          institutionId: metadata.institutionId ?? null,
          institutionName: metadata.institutionName ?? null,
          accounts: metadata.accounts ?? [],
        };
      }),
    );
  });

  // POST /api/me/agents/:agentInstanceId/connections/:dataSourceTypeId/init
  app.post(
    "/:agentInstanceId/connections/:dataSourceTypeId/init",
    async (c) => {
      const agentInstanceId = c.req.param("agentInstanceId");
      const dataSourceTypeId = c.req.param("dataSourceTypeId");
      const body = await c.req.json().catch(() => ({}));

      // Look up the agent type to find the adapter
      // For now, iterate all agent types to find the matching data source
      const allTypes = registry.getAllAgentTypes();
      let adapter;
      for (const type of allTypes) {
        adapter = type.dataSources.find((ds) => ds.typeId === dataSourceTypeId);
        if (adapter) break;
      }

      if (!adapter) {
        return c.json({ error: "Data source type not found" }, 404);
      }

      const config = await adapter.getConnectionConfig(agentInstanceId, {
        redirectUri: body.redirectUri,
        institutionId: body.institutionId,
      });
      return c.json(config);
    },
  );

  // POST /api/me/agents/:agentInstanceId/connections/:dataSourceTypeId/finalize
  app.post(
    "/:agentInstanceId/connections/:dataSourceTypeId/finalize",
    async (c) => {
      const agentInstanceId = c.req.param("agentInstanceId");
      const dataSourceTypeId = c.req.param("dataSourceTypeId");
      const body = await c.req.json();

      const allTypes = registry.getAllAgentTypes();
      let adapter;
      for (const type of allTypes) {
        adapter = type.dataSources.find((ds) => ds.typeId === dataSourceTypeId);
        if (adapter) break;
      }

      if (!adapter) {
        return c.json({ error: "Data source type not found" }, 404);
      }

      const result = await adapter.finalizeConnection({
        agentInstanceId,
        dataSourceTypeId,
        ...body,
      });

      return c.json({ connection: result }, 201);
    },
  );

  // POST /api/me/agents/:agentInstanceId/connections/:connectionId/sync
  app.post("/:agentInstanceId/connections/:connectionId/sync", async (c) => {
    const [conn] = await db
      .select()
      .from(dataSourceConnections)
      .where(eq(dataSourceConnections.id, c.req.param("connectionId")))
      .limit(1);

    if (!conn) return c.json({ error: "Connection not found" }, 404);

    await dataSourceSyncQueue.add(`manual-sync-${conn.id}`, {
      connectionId: conn.id,
      agentInstanceId: conn.agentInstanceId,
      dataSourceTypeId: conn.dataSourceTypeId,
    });

    return c.json({ status: "queued" });
  });

  // DELETE /api/me/agents/:agentInstanceId/connections/:connectionId
  app.delete("/:agentInstanceId/connections/:connectionId", async (c) => {
    await db
      .delete(dataSourceConnections)
      .where(eq(dataSourceConnections.id, c.req.param("connectionId")));
    return c.body(null, 204);
  });

  return app;
}
