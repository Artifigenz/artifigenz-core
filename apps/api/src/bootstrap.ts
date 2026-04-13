import { AgentRegistry } from "./platform/registry/agent-registry";
import { register as registerFinance } from "./agents/finance";
import { register as registerHealth } from "./agents/health";

const registry = new AgentRegistry();

export function bootstrapAgents(): AgentRegistry {
  registerFinance(registry);
  registerHealth(registry);
  return registry;
}
