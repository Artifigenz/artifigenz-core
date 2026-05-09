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
    const agentInstanceId = c.req.param("agentInstanceId");

    // Select core columns that always exist
    const connections = await db
      .select({
        id: dataSourceConnections.id,
        dataSourceTypeId: dataSourceConnections.dataSourceTypeId,
        displayName: dataSourceConnections.displayName,
        status: dataSourceConnections.status,
        metadata: dataSourceConnections.metadata,
        lastSyncedAt: dataSourceConnections.lastSyncedAt,
      })
      .from(dataSourceConnections)
      .where(eq(dataSourceConnections.agentInstanceId, agentInstanceId));

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
          // Health status - will be populated once migration runs
          health: {
            isHealthy: true,
            lastSyncStatus: null,
            lastSyncError: null,
            requiresReauth: false,
            consecutiveFailures: 0,
            suggestedAction: null,
          },
        };
      }),
    );
  });

  // GET /api/me/agents/:agentInstanceId/connections/health
  // Separate endpoint for health data (requires migration to be run)
  app.get("/:agentInstanceId/connections/health", async (c) => {
    const agentInstanceId = c.req.param("agentInstanceId");

    try {
      const connections = await db
        .select({
          id: dataSourceConnections.id,
          lastSyncStatus: dataSourceConnections.lastSyncStatus,
          lastSyncError: dataSourceConnections.lastSyncError,
          requiresReauth: dataSourceConnections.requiresReauth,
          consecutiveFailures: dataSourceConnections.consecutiveFailures,
        })
        .from(dataSourceConnections)
        .where(eq(dataSourceConnections.agentInstanceId, agentInstanceId));

      const healthMap: Record<string, {
        isHealthy: boolean;
        lastSyncStatus: string | null;
        lastSyncError: string | null;
        requiresReauth: boolean;
        consecutiveFailures: number;
        suggestedAction: "reconnect" | "upload" | null;
      }> = {};

      for (const conn of connections) {
        const lastSyncStatus = conn.lastSyncStatus;
        const consecutiveFailures = conn.consecutiveFailures ?? 0;
        const requiresReauth = conn.requiresReauth ?? false;
        const isHealthy = lastSyncStatus === "success" || !lastSyncStatus;

        let suggestedAction: "reconnect" | "upload" | null = null;
        if (requiresReauth) {
          suggestedAction = "reconnect";
        } else if (consecutiveFailures >= 3) {
          suggestedAction = "upload";
        } else if (!isHealthy) {
          suggestedAction = "reconnect";
        }

        healthMap[conn.id] = {
          isHealthy,
          lastSyncStatus,
          lastSyncError: conn.lastSyncError,
          requiresReauth,
          consecutiveFailures,
          suggestedAction,
        };
      }

      return c.json(healthMap);
    } catch {
      // Health columns don't exist yet
      return c.json({});
    }
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

      try {
        const config = await adapter.getConnectionConfig(agentInstanceId, {
          redirectUri: body.redirectUri,
          institutionId: body.institutionId,
        });
        return c.json(config);
      } catch (err) {
        // Surface Plaid's actual error_message / error_code so the frontend
        // can distinguish cases like INVALID_INSTITUTION and fall back.
        const plaid = (err as { response?: { data?: {
          error_message?: string;
          error_code?: string;
          error_type?: string;
        } } }).response?.data;
        const message =
          plaid?.error_message ??
          (err instanceof Error ? err.message : "Plaid error");
        return c.json({
          error: message,
          error_code: plaid?.error_code,
          error_type: plaid?.error_type,
        }, 500);
      }
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
