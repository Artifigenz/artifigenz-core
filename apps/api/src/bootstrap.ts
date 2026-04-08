import { AgentRegistry } from "./platform/registry/agent-registry";
// Agent registrations will be added as agents are implemented
// import { register as registerFinance } from "./agents/finance";

const registry = new AgentRegistry();

export function bootstrapAgents(): AgentRegistry {
  // Phase 2: registerFinance(registry);
  // Phase 5: registerTravel(registry);
  return registry;
}
