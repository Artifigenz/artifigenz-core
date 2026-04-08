import type {
  AgentTypeDefinition,
  SkillDefinition,
  DataSourceTypeDefinition,
} from "./types";

export class AgentRegistry {
  private agents = new Map<string, AgentTypeDefinition>();

  registerAgent(definition: AgentTypeDefinition): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent type "${definition.id}" is already registered`);
    }
    this.agents.set(definition.id, definition);
  }

  getAgentType(id: string): AgentTypeDefinition | undefined {
    return this.agents.get(id);
  }

  getAllAgentTypes(): AgentTypeDefinition[] {
    return Array.from(this.agents.values());
  }

  getSkillsForAgent(agentTypeId: string): SkillDefinition[] {
    return this.agents.get(agentTypeId)?.skills ?? [];
  }

  getDataSourcesForAgent(agentTypeId: string): DataSourceTypeDefinition[] {
    return this.agents.get(agentTypeId)?.dataSources ?? [];
  }

  getSkill(agentTypeId: string, skillId: string): SkillDefinition | undefined {
    return this.getSkillsForAgent(agentTypeId).find((s) => s.id === skillId);
  }

  getDataSource(
    agentTypeId: string,
    dataSourceTypeId: string,
  ): DataSourceTypeDefinition | undefined {
    return this.getDataSourcesForAgent(agentTypeId).find(
      (ds) => ds.typeId === dataSourceTypeId,
    );
  }
}
