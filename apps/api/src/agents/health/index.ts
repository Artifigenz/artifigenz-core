import type { AgentRegistry } from "../../platform/registry/agent-registry";
import type { AgentTypeDefinition } from "../../platform/registry/types";
import { wellnessSkill } from "./skills/wellness.skill";
import { appleHealthAdapter } from "./data-sources/apple-health.adapter";

export const healthAgent: AgentTypeDefinition = {
  id: "health",
  name: "Health",
  description: "Notices patterns in your habits before you do.",
  icon: "heart",
  dataSources: [appleHealthAdapter],
  skills: [wellnessSkill],
};

export function register(registry: AgentRegistry): void {
  registry.registerAgent(healthAgent);
}
