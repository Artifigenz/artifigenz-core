import { AGENTS } from '@artifigenz/shared';
import Activate from './Activate';

export function generateStaticParams() {
  return AGENTS.map((a) => ({
    name: a.name.toLowerCase().replace(/\s+/g, '-'),
  }));
}

export default function ActivatePage({ params }: { params: Promise<{ name: string }> }) {
  return <Activate params={params} />;
}
