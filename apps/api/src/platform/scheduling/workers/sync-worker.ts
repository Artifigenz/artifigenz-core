import { Worker } from "bullmq";
import { getRedisConnection } from "../queues";
import { skillExecutionQueue } from "../queues";
import { eventBus } from "../../events/event-bus";
import { DATA_SOURCE_SYNCED } from "../../events/event-types";
import type { AgentRegistry } from "../../registry/agent-registry";

export function createSyncWorker(registry: AgentRegistry) {
  return new Worker(
    "data_source_sync",
    async (job) => {
      const { connectionId, agentInstanceId, dataSourceTypeId, agentTypeId } =
        job.data;

      console.log(
        `[SyncWorker] Syncing "${dataSourceTypeId}" for instance "${agentInstanceId}"`,
      );

      const adapter = registry.getDataSource(agentTypeId, dataSourceTypeId);
      if (!adapter) {
        throw new Error(
          `Data source adapter "${dataSourceTypeId}" not found for agent type "${agentTypeId}"`,
        );
      }

      const connection = {
        id: connectionId,
        agentInstanceId,
        dataSourceTypeId,
        displayName: "",
        status: "active",
        credentials: {},
        metadata: {},
      };

      const data = await adapter.sync(connection);

      eventBus.emit(DATA_SOURCE_SYNCED, {
        connectionId,
        agentInstanceId,
        dataSourceTypeId,
        recordCount: data.length,
      });

      console.log(`[SyncWorker] Synced ${data.length} records`);
      return { recordCount: data.length };
    },
    {
      connection: getRedisConnection(),
      concurrency: 3,
    },
  );
}
