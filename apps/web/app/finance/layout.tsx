import { AgentModeGate } from '@/components/auth/AgentModeGate';

/**
 * /finance/* — internal-only while we ship the chat-only public product.
 * AgentModeGate redirects to / (the chat) when the DevTools agent-mode
 * toggle is off, so a public user never sees Finance even by typing the
 * URL.
 */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <AgentModeGate>{children}</AgentModeGate>;
}
