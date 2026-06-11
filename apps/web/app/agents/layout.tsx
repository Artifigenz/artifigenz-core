import { AgentModeGate } from '@/components/auth/AgentModeGate';

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return <AgentModeGate>{children}</AgentModeGate>;
}
