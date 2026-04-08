import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

function getConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsed = new URL(url);
  const useTls = parsed.protocol === "rediss:";
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379"),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: useTls ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

// Lazy queue creation — only connect when actually used
let _skillQueue: Queue | null = null;
let _syncQueue: Queue | null = null;
let _deliveryQueue: Queue | null = null;
let _parseQueue: Queue | null = null;

export function getRedisConnection(): ConnectionOptions {
  return getConnection();
}

export const skillExecutionQueue = {
  get instance() {
    if (!_skillQueue) _skillQueue = new Queue("skill_execution", { connection: getConnection() });
    return _skillQueue;
  },
  add: (...args: Parameters<Queue["add"]>) => skillExecutionQueue.instance.add(...args),
  upsertJobScheduler: (...args: Parameters<Queue["upsertJobScheduler"]>) =>
    skillExecutionQueue.instance.upsertJobScheduler(...args),
};

export const dataSourceSyncQueue = {
  get instance() {
    if (!_syncQueue) _syncQueue = new Queue("data_source_sync", { connection: getConnection() });
    return _syncQueue;
  },
  add: (...args: Parameters<Queue["add"]>) => dataSourceSyncQueue.instance.add(...args),
};

export const deliveryQueue = {
  get instance() {
    if (!_deliveryQueue) _deliveryQueue = new Queue("delivery", { connection: getConnection() });
    return _deliveryQueue;
  },
  add: (...args: Parameters<Queue["add"]>) => deliveryQueue.instance.add(...args),
};

export const fileParseQueue = {
  get instance() {
    if (!_parseQueue) _parseQueue = new Queue("file_parse", { connection: getConnection() });
    return _parseQueue;
  },
  add: (...args: Parameters<Queue["add"]>) => fileParseQueue.instance.add(...args),
};

export { getRedisConnection as redisConnection };
