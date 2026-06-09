import type { AgentRegistry } from "../../platform/registry/agent-registry";
import type { AgentTypeDefinition } from "../../platform/registry/types";
import { plaidAdapter } from "./data-sources/plaid.adapter";
import { fileUploadAdapter } from "./data-sources/file-upload.adapter";
import { dailyPulseSkill } from "./skills/daily-pulse.skill";

export const financeAgent: AgentTypeDefinition = {
  id: "finance",
  name: "Finance",
  description: "Watches your money. Finds patterns. Delivers insights.",
  icon: "wallet",
  dataSources: [plaidAdapter, fileUploadAdapter],
  skills: [dailyPulseSkill],
};

export function register(registry: AgentRegistry): void {
  registry.registerAgent(financeAgent);
}
