import { AgentModeGate } from '@/components/auth/AgentModeGate';

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return <AgentModeGate>{children}</AgentModeGate>;
}
