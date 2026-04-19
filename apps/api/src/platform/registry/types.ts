export interface InsightTypeDefinition {
  id: string;
  name: string;
  critical: boolean;
  deliveryChannels: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  agentTypeId: string;

  triggers: {
    schedule?: string;
    events?: string[];
  };

  insightTypes: InsightTypeDefinition[];

  analyze: (ctx: SkillExecutionContext) => Promise<InsightOutput[]>;
}

export interface DataSourceTypeDefinition {
  typeId: string;
  name: string;
  description: string;
  connectionFlow: "oauth" | "api_key" | "file_upload" | "sdk";
  syncMechanism: "webhook" | "polling" | "manual";
  pollingInterval?: string;

  getConnectionConfig(
    agentInstanceId: string,
    options?: { redirectUri?: string; institutionId?: string },
  ): Promise<ConnectionConfig>;
  finalizeConnection(params: FinalizeParams): Promise<DataSourceConnectionResult>;
  testConnection(connection: DataSourceConnectionResult): Promise<boolean>;
  disconnect(connection: DataSourceConnectionResult): Promise<void>;

  sync(connection: DataSourceConnectionResult): Promise<NormalizedData[]>;
  handleWebhook?(payload: unknown): Promise<WebhookResult>;
}

export interface AgentTypeDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  dataSources: DataSourceTypeDefinition[];
  skills: SkillDefinition[];
  configSchema?: Record<string, unknown>;
}

// ─── Execution types ────────────────────────────────────────────────

export interface SkillExecutionContext {
  agentInstance: { id: string; userId: string; agentTypeId: string; goal: string | null };
  user: { id: string; email: string; timezone: string };
  userGoal: string | null;

  getData<T>(query: DataQuery): Promise<T[]>;
  getSkillState<T>(): Promise<T | null>;
  setSkillState<T>(state: T): Promise<void>;
  getContext(): Promise<UnifiedContext>;
  updateFacts(facts: Record<string, unknown>): Promise<void>;
}

export interface InsightOutput {
  insightTypeId: string;
  title: string;
  description: string;
  data: Record<string, unknown>;
  critical: boolean;
}

export interface DataQuery {
  table: string;
  where?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
}

export interface UnifiedContext {
  facts: Record<string, unknown>;
  observations: Array<{ text: string; confidence: string }>;
  stated: Array<{ type: string; text: string }>;
  behavioral: Record<string, unknown>;
}

// ─── Data source types ──────────────────────────────────────────────

export interface ConnectionConfig {
  [key: string]: unknown;
}

export interface FinalizeParams {
  agentInstanceId: string;
  dataSourceTypeId: string;
  [key: string]: unknown;
}

export interface DataSourceConnectionResult {
  id: string;
  agentInstanceId: string;
  dataSourceTypeId: string;
  displayName: string;
  status: string;
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface NormalizedData {
  [key: string]: unknown;
}

export interface WebhookResult {
  connectionId: string;
  action: "sync" | "update" | "none";
  data?: unknown;
}
