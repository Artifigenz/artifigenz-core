import { AgentModeGate } from '@/components/auth/AgentModeGate';

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return <AgentModeGate>{children}</AgentModeGate>;
}
