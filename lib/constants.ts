export interface Product {
  name: string;
  description: string;
  delay: number;
}

export const PRODUCTS: Product[] = [
  {
    name: 'AgentBoba',
    description: 'the trust authority for AI agents',
    delay: 0,
  },
  {
    name: 'RunLife',
    description: 'personal life OS',
    delay: 80,
  },
  {
    name: 'Gorilla',
    description: 'AI marketing engine for X',
    delay: 160,
  },
  {
    name: 'TARS',
    description: 'shipping pulse dashboard',
    delay: 240,
  },
];

export const FOUNDERS = [
  { name: 'Cooper', url: 'https://x.com/CooperAIWorks' },
  { name: 'Rajan RK', url: 'https://x.com/rajanbuilds' },
] as const;

export const SOCIAL = {
  x: {
    url: 'https://x.com/FigenzAI',
    handle: '@FigenzAI',
  },
} as const;
