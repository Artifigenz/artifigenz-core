export const DATA_SOURCE_SYNCED = "data_source.synced" as const;
export const INSIGHT_CREATED = "insight.created" as const;
export const AGENT_ACTIVATED = "agent.activated" as const;
export const SKILL_TOGGLED = "skill.toggled" as const;

export type EventType =
  | typeof DATA_SOURCE_SYNCED
  | typeof INSIGHT_CREATED
  | typeof AGENT_ACTIVATED
  | typeof SKILL_TOGGLED;

export interface EventPayload {
  [DATA_SOURCE_SYNCED]: {
    connectionId: string;
    agentInstanceId: string;
    dataSourceTypeId: string;
    recordCount: number;
  };
  [INSIGHT_CREATED]: {
    insightId: string;
    userId: string;
    agentInstanceId: string;
    insightTypeId: string;
    critical: boolean;
  };
  [AGENT_ACTIVATED]: {
    agentInstanceId: string;
    userId: string;
    agentTypeId: string;
  };
  [SKILL_TOGGLED]: {
    agentInstanceId: string;
    skillId: string;
    enabled: boolean;
  };
}
