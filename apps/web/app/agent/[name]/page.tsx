import AgentDetail from './AgentDetail';

const AGENT_NAMES = ['finance', 'travel', 'health', 'research'];

export function generateStaticParams() {
  return AGENT_NAMES.map((name) => ({ name }));
}

export default function AgentPage({ params }: { params: Promise<{ name: string }> }) {
  return <AgentDetail params={params} />;
}
