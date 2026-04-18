'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import Header from '@/components/layout/Header';
import { AGENTS } from '@artifigenz/shared';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import * as Icons from '@/components/sections/AgentIcons';
import * as CapIcons from '@/components/sections/CapabilityIcons';
import styles from './page.module.css';

const ICON_MAP: Record<string, React.ComponentType> = {
  Finance: Icons.FinanceIcon,
  Travel: Icons.TravelIcon,
  Health: Icons.HealthIcon,
  Research: Icons.ResearchIcon,
  'Job Search': Icons.JobSearchIcon,
};

const CAPABILITY_ICON_MAP: Record<string, React.ComponentType> = {
  repeat: CapIcons.RepeatIcon,
  arrowUpCircle: CapIcons.ArrowUpCircleIcon,
  alertTriangle: CapIcons.AlertTriangleIcon,
  barChart: CapIcons.BarChartIcon,
  tag: CapIcons.TagIcon,
  bell: CapIcons.BellIcon,
  map: CapIcons.MapIcon,
  passport: CapIcons.PassportIcon,
  moon: CapIcons.MoonIcon,
  activity: CapIcons.ActivityIcon,
  droplet: CapIcons.DropletIcon,
  link: CapIcons.LinkIcon,
  scan: CapIcons.ScanIcon,
  eye: CapIcons.EyeIcon,
  fileText: CapIcons.FileTextIcon,
  trendingUp: CapIcons.TrendingUpIcon,
  target: CapIcons.TargetIcon,
  checkSquare: CapIcons.CheckSquareIcon,
  dollarSign: CapIcons.DollarSignIcon,
  users: CapIcons.UsersIcon,
};

interface Capability {
  label: string;
  description: string;
  icon: string;
}

interface InsightMockup {
  category: string;
  title: string;
  detail: string;
  mustSee?: boolean;
}

interface TelegramMockup {
  text: string;
  timestamp: string;
}

interface EmailMockup {
  sender: string;
  subject: string;
  preview: string;
  timestamp: string;
}

interface ChannelSamples {
  insight: InsightMockup;
  telegram: TelegramMockup;
  email: EmailMockup;
}

interface AccountOption {
  name: string;
  description: string;
}

interface ActivationSkill {
  name: string;
}

interface ActivationData {
  tagline: string;
  greeting: string; // Use {name} as placeholder for the user's first name
  pitch: string;
  capabilities: Capability[];
  channels: ChannelSamples;
  requiresAccounts: boolean;
  accountOptions: AccountOption[];
  suggestedGoals: string[];
  skills: ActivationSkill[];
  estimatedSetupSeconds: number;
}

interface MockAccount {
  label: string;
  last4: string;
}
interface MockBank {
  bank: string;
  accounts: MockAccount[];
}

// UI mockup: cycled through as the user taps "Add another" during onboarding.
const MOCK_BANK_POOL: MockBank[] = [
  { bank: 'Chase', accounts: [
    { label: 'Checking', last4: '4521' },
    { label: 'Sapphire Preferred', last4: '8832' },
  ]},
  { bank: 'American Express', accounts: [
    { label: 'Platinum', last4: '1007' },
  ]},
  { bank: 'Wells Fargo', accounts: [
    { label: 'Everyday Checking', last4: '3310' },
    { label: 'Way2Save', last4: '7821' },
    { label: 'Active Cash', last4: '2244' },
  ]},
  { bank: 'Bank of America', accounts: [
    { label: 'Advantage Plus', last4: '9921' },
    { label: 'Cash Rewards', last4: '3347' },
  ]},
  { bank: 'Capital One', accounts: [
    { label: '360 Checking', last4: '1155' },
    { label: 'Venture', last4: '6602' },
  ]},
  { bank: 'Citi', accounts: [
    { label: 'Priority Checking', last4: '7789' },
    { label: 'Double Cash', last4: '4410' },
  ]},
];

const ACTIVATION_DATA: Record<string, ActivationData> = {
  finance: {
    tagline: "I watch your money so you don't have to.",
    greeting: "Hey {name} \u2014 let\u2019s put your finances on autopilot.",
    pitch: "I'll quietly track every charge, flag the ones that change, and tell you when something's off — before it costs you. No spreadsheets, no thinking required.",
    capabilities: [
      { label: 'Spot forgotten subscriptions', description: 'Every recurring charge across all accounts, in one place.', icon: 'repeat' },
      { label: 'Catch bill increases', description: 'Notice the moment a subscription quietly raises its price.', icon: 'arrowUpCircle' },
      { label: 'Flag unusual spending', description: 'When a category creeps above your average, I tell you why.', icon: 'alertTriangle' },
      { label: 'Forecast your month', description: "Always-on cash flow projection based on what's already booked.", icon: 'barChart' },
    ],
    channels: {
      insight: {
        category: 'Bill Change',
        title: 'Netflix increased by 48%',
        detail: '$15.49/mo → $22.99/mo. Adds $90/year to your subscriptions.',
        mustSee: true,
      },
      telegram: {
        text: "Heads up — Netflix just jumped from $15.49 to $22.99/mo. That's $90/year extra.",
        timestamp: '2:47 PM',
      },
      email: {
        sender: 'Artifigenz',
        subject: 'Your weekly finance summary',
        preview: 'Spent $1,240 this week. Netflix raised its price, 2 other subscriptions flagged for review...',
        timestamp: '2h',
      },
    },
    requiresAccounts: true,
    accountOptions: [
      { name: 'Chase', description: 'Connect via Plaid — read-only, ~30 seconds' },
      { name: 'Amex', description: 'Connect via Plaid — read-only, ~30 seconds' },
      { name: 'Upload CSV', description: 'Upload a statement from any bank instead' },
    ],
    suggestedGoals: [
      'Save $500 per month',
      'Understand where my money goes',
      'Stop wasting on unused subscriptions',
      'Catch bill increases before they hit',
      'Stay under budget on dining',
    ],
    skills: [
      { name: 'Recurring Charges' },
      { name: 'Spending Breakdown' },
      { name: 'Bill Change Detection' },
      { name: 'New Charge Detection' },
      { name: 'Cash Flow Forecast' },
      { name: 'Income vs. Spending' },
    ],
    estimatedSetupSeconds: 60,
  },
  travel: {
    tagline: "I'll find the deal before the seat's gone.",
    greeting: "Hey {name} \u2014 let\u2019s make your next trip effortless.",
    pitch: "I watch fares, hotel availability, and travel docs for the places you care about — and tell you the moment something worth booking shows up.",
    capabilities: [
      { label: 'Track fares automatically', description: 'Set destinations once; I watch prices 24/7.', icon: 'tag' },
      { label: 'Alert on deal windows', description: 'Know the moment flights drop for your dates.', icon: 'bell' },
      { label: 'Build itineraries fast', description: 'Flights, hotels, and activities in one flow.', icon: 'map' },
      { label: 'Flag visa & passport issues', description: 'Never get blindsided at the airport.', icon: 'passport' },
    ],
    channels: {
      insight: {
        category: 'Price Drop',
        title: 'Tokyo flights dropped 34% for April 12–19',
        detail: 'Round-trip from JFK now $287. Lowest in 90 days.',
        mustSee: true,
      },
      telegram: {
        text: 'Tokyo window just opened. $287 round-trip JFK for Apr 12–19. Lowest price in 90 days.',
        timestamp: '11:08 AM',
      },
      email: {
        sender: 'Artifigenz',
        subject: 'Deal alert: Tokyo under $300',
        preview: "The Tokyo window you've been watching just opened. $287 round-trip for Apr 12–19...",
        timestamp: '18m',
      },
    },
    requiresAccounts: true,
    accountOptions: [
      { name: 'Google Flights', description: 'Sync your watched routes and price alerts' },
      { name: 'Kayak', description: 'Import your saved searches and destinations' },
    ],
    suggestedGoals: [
      'Find deals to Tokyo, Bali, or Florida',
      'Stay under $2,000 per trip',
      'Only travel during school breaks',
      'Prefer nonstop flights',
    ],
    skills: [
      { name: 'Price Tracking' },
      { name: 'Deal Alerts' },
      { name: 'Itinerary Builder' },
      { name: 'Visa Requirements' },
      { name: 'Hotel Comparison' },
    ],
    estimatedSetupSeconds: 45,
  },
  health: {
    tagline: 'I notice the patterns before you do.',
    greeting: "Hey {name} \u2014 let\u2019s make healthy habits stick.",
    pitch: "I quietly track your sleep, activity, and habits — and flag the trends worth paying attention to before they become problems.",
    capabilities: [
      { label: 'Spot sleep trends early', description: 'Catch patterns in your rest before they become chronic.', icon: 'moon' },
      { label: 'Track activity streaks', description: 'Gentle nudges when your movement drops off.', icon: 'activity' },
      { label: 'Monitor hydration', description: 'Simple daily check-ins, no guilt trips.', icon: 'droplet' },
      { label: 'Connect habits to outcomes', description: 'Understand what actually moves your numbers.', icon: 'link' },
    ],
    channels: {
      insight: {
        category: 'Sleep',
        title: 'Sleep dropped below 6h three nights this week',
        detail: '14-day average: 5.2 hrs. Baseline 7.1 hrs.',
        mustSee: true,
      },
      telegram: {
        text: 'Sleep alert — 5.2h average over 14 days, baseline is 7.1. Want to review what changed?',
        timestamp: '8:30 AM',
      },
      email: {
        sender: 'Artifigenz',
        subject: 'Your weekly health digest',
        preview: 'Sleep is down (3 nights under 6h), steps are up 12%, hydration streak holding at 5 days...',
        timestamp: '1h',
      },
    },
    requiresAccounts: true,
    accountOptions: [
      { name: 'Apple Health', description: 'Sync sleep, steps, heart rate, and workouts' },
      { name: 'Fitbit', description: 'Sync your Fitbit device data directly' },
    ],
    suggestedGoals: [
      'Get sleep back above 7 hours',
      'Maintain step count above 8,000/day',
      'Drink 8 glasses of water daily',
      'Build a consistent morning routine',
    ],
    skills: [
      { name: 'Sleep Analysis' },
      { name: 'Step Tracking' },
      { name: 'Hydration' },
      { name: 'Nutrition Logging' },
      { name: 'Mood Tracking' },
    ],
    estimatedSetupSeconds: 45,
  },
  research: {
    tagline: 'I go deep so you get the short version.',
    greeting: "Hey {name} \u2014 let\u2019s keep you ahead of the curve.",
    pitch: 'I monitor papers, competitors, and trends on the topics you care about — and hand you the 2-minute version when something matters.',
    capabilities: [
      { label: 'Daily topic scans', description: 'New papers, news, and posts filtered to what you care about.', icon: 'scan' },
      { label: 'Competitor watching', description: 'Know when your rivals ship, price-change, or pivot.', icon: 'eye' },
      { label: 'Clean summaries', description: 'Every report distilled to what you actually need to know.', icon: 'fileText' },
      { label: 'Trend spotting', description: "Catch shifts in your space before they're obvious.", icon: 'trendingUp' },
    ],
    channels: {
      insight: {
        category: 'Report',
        title: 'Competitive analysis ready — 12 pages',
        detail: '5 competitors analyzed: positioning, pricing, feature gaps.',
        mustSee: true,
      },
      telegram: {
        text: "Your competitive report is done. 12 pages, 5 players, 2 gaps nobody's filling yet.",
        timestamp: '10:44 AM',
      },
      email: {
        sender: 'Artifigenz',
        subject: "This week's research digest",
        preview: 'Competitive analysis ready, 3 new papers on AI adoption, 1 market trend summary...',
        timestamp: '3h',
      },
    },
    requiresAccounts: false,
    accountOptions: [],
    suggestedGoals: [
      'Track AI agent adoption research',
      'Monitor competitors in my space',
      'Stay current on my industry weekly',
      'Get summaries under 500 words',
    ],
    skills: [
      { name: 'Topic Deep-dives' },
      { name: 'Competitor Analysis' },
      { name: 'Summarization' },
      { name: 'Trend Spotting' },
      { name: 'Source Verification' },
    ],
    estimatedSetupSeconds: 30,
  },
  'job-search': {
    tagline: "I'll find the roles worth your time.",
    greeting: "Hey {name} \u2014 let\u2019s find a role that actually fits.",
    pitch: 'I match new openings to your profile, track your applications, and keep tabs on salary benchmarks — so you stop refreshing job boards.',
    capabilities: [
      { label: 'Match roles automatically', description: 'New postings filtered to your skills and ambitions.', icon: 'target' },
      { label: 'Track applications', description: 'Know where every submission stands, no spreadsheet needed.', icon: 'checkSquare' },
      { label: 'Benchmark salaries', description: "Real numbers for the roles you're targeting.", icon: 'dollarSign' },
      { label: 'Spot warm intros', description: 'Notice when someone you know joins a target company.', icon: 'users' },
    ],
    channels: {
      insight: {
        category: 'New Roles',
        title: '3 new roles matching your profile',
        detail: 'Senior PM at Anthropic, Staff PM at OpenAI, Head of Product at Cohere.',
        mustSee: true,
      },
      telegram: {
        text: '3 roles that fit your profile just posted. Senior PM at Anthropic stands out.',
        timestamp: '9:12 AM',
      },
      email: {
        sender: 'Artifigenz',
        subject: '3 new matches this morning',
        preview: 'Senior PM at Anthropic, Staff PM at OpenAI, Head of Product at Cohere. All remote-friendly...',
        timestamp: '45m',
      },
    },
    requiresAccounts: true,
    accountOptions: [
      { name: 'LinkedIn', description: 'Sync your profile, connections, and saved searches' },
      { name: 'Indeed', description: 'Import your profile and tracked applications' },
    ],
    suggestedGoals: [
      'Find a senior product role in AI/ML',
      'Target $180k+ base salary',
      'Prefer remote or hybrid in SF Bay Area',
      'Only apply to companies with >50 employees',
    ],
    skills: [
      { name: 'Job Matching' },
      { name: 'Application Tracking' },
      { name: 'Interview Prep' },
      { name: 'Salary Benchmarking' },
      { name: 'Network Alerts' },
    ],
    estimatedSetupSeconds: 45,
  },
};

export default function Activate({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const router = useRouter();
  const { activate } = useActivatedAgents();
  const { user } = useUser();
  const firstName =
    user?.firstName ||
    user?.username ||
    user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ||
    '';
  const slug = name.toLowerCase();
  const agent = AGENTS.find((a) => a.name.toLowerCase().replace(/\s+/g, '-') === slug);
  const data = ACTIVATION_DATA[slug];
  const IconComponent = agent ? ICON_MAP[agent.name] : undefined;

  const [step, setStep] = useState(0);
  const [connectedBanks, setConnectedBanks] = useState<MockBank[]>([]);
  const connectedAccountNames = connectedBanks.flatMap((cb) =>
    cb.accounts.map((a) => `${cb.bank} ${a.label}`)
  );
  const totalAccountCount = connectedAccountNames.length;
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [newGoal, setNewGoal] = useState('');
  const [activeSkills, setActiveSkills] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    (data?.skills ?? []).forEach((s) => {
      init[s.name] = true;
    });
    return init;
  });
  const [skillsExpanded, setSkillsExpanded] = useState(false);

  // Shuffle animation for example insights (Step 0)
  const [shuffleIndex, setShuffleIndex] = useState(0);
  useEffect(() => {
    if (step !== 0) return;
    const interval = setInterval(() => {
      setShuffleIndex((i) => i + 1);
    }, 2800);
    return () => clearInterval(interval);
  }, [step]);

  // Typewriter greeting — persona adapts to current step + state
  const targetGreeting = (() => {
    if (!data) return '';
    const name = firstName || 'there';
    if (step === 0) return data.greeting.replace('{name}', name);
    if (step === 1 && data.requiresAccounts) {
      return `Alright ${name} \u2014 connect the banks you want me to watch, then hit Activate.`;
    }
    return data.greeting.replace('{name}', name);
  })();
  const [typedChars, setTypedChars] = useState(0);
  useEffect(() => {
    setTypedChars(0);
    if (!targetGreeting) return;
    const interval = setInterval(() => {
      setTypedChars((prev) => {
        if (prev >= targetGreeting.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 26);
    return () => clearInterval(interval);
  }, [targetGreeting]);
  const displayedGreeting = targetGreeting.slice(0, typedChars);
  const isTyping = typedChars < targetGreeting.length;

  // Location-aware bank list for Step 0 Card 1
  const bankList = (() => {
    const BANKS_BY_REGION: Record<string, string[]> = {
      US: ['Chase', 'Bank of America', 'Wells Fargo', 'Citi', 'Capital One', 'American Express'],
      CA: ['TD', 'RBC', 'BMO', 'Scotiabank', 'CIBC', 'Tangerine'],
      GB: ['Barclays', 'HSBC', 'Lloyds', 'NatWest', 'Santander', 'Monzo'],
      AU: ['Commonwealth', 'Westpac', 'NAB', 'ANZ', 'Macquarie', 'Bendigo'],
      IN: ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak', 'Yes Bank'],
      DE: ['Deutsche Bank', 'Commerzbank', 'ING', 'Sparkasse', 'DKB', 'N26'],
      FR: ['BNP Paribas', 'Crédit Agricole', 'Société Générale', 'LCL', 'La Banque Postale', 'BPCE'],
    };
    if (typeof navigator === 'undefined') return BANKS_BY_REGION.US;
    try {
      const locale = new Intl.Locale(navigator.language);
      const region = locale.maximize().region ?? 'US';
      return BANKS_BY_REGION[region] ?? BANKS_BY_REGION.US;
    } catch {
      return BANKS_BY_REGION.US;
    }
  })();

  if (!agent) {
    return (
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <p>Agent not found.</p>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <div className={styles.agentHeader}>
            <div>
              <div className={styles.nameRow}>
                <h1 className={styles.agentName}>{agent.name}</h1>
              </div>
              <p className={styles.tagline}>{agent.pitch}</p>
            </div>
          </div>
          <p className={styles.pitch}>Activation flow coming soon for this agent.</p>
        </main>
      </div>
    );
  }

  const addNextBank = () => {
    setConnectedBanks((prev) => {
      const taken = new Set(prev.map((b) => b.bank));
      const next = MOCK_BANK_POOL.find((b) => !taken.has(b.bank));
      if (!next) return prev;
      return [...prev, next];
    });
  };
  const removeBank = (bankName: string) => {
    setConnectedBanks((prev) => prev.filter((b) => b.bank !== bankName));
  };

  const toggleGoal = (goal: string) => {
    setSelectedGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  };

  const addCustomGoal = () => {
    const trimmed = newGoal.trim();
    if (!trimmed) return;
    if (!selectedGoals.includes(trimmed)) {
      setSelectedGoals([...selectedGoals, trimmed]);
    }
    setNewGoal('');
  };

  const removeGoal = (goal: string) => {
    setSelectedGoals(selectedGoals.filter((g) => g !== goal));
  };

  const toggleSkill = (skillName: string) => {
    setActiveSkills((prev) => ({ ...prev, [skillName]: !prev[skillName] }));
  };

  const activeSkillCount = Object.values(activeSkills).filter(Boolean).length;

  const next = () => {
    if (step === 0) setStep(data.requiresAccounts ? 1 : 2);
    else if (step === 1) {
      // Bank connect is the final step for account-based agents
      activate({
        slug,
        activatedAt: Date.now(),
        accounts: connectedAccountNames,
        goals: selectedGoals,
        skills: activeSkills,
      });
      router.push(`/agent/${slug}`);
    }
    else if (step === 2) setStep(3);
    else if (step === 3) {
      activate({
        slug,
        activatedAt: Date.now(),
        accounts: connectedAccountNames,
        goals: selectedGoals,
        skills: activeSkills,
      });
      router.push(`/agent/${slug}`);
    }
  };

  const back = () => {
    if (step === 1) setStep(0);
    else if (step === 2) setStep(data.requiresAccounts ? 1 : 0);
    else if (step === 3) setStep(2);
  };

  const stepBadge = (() => {
    if (step === 0) return null;
    if (!data.requiresAccounts) {
      if (step === 2) return 'Step 1 of 2';
      if (step === 3) return 'Step 2 of 2';
    } else {
      if (step === 1) return 'Step 1 of 3';
      if (step === 2) return 'Step 2 of 3';
      if (step === 3) return 'Step 3 of 3';
    }
    return null;
  })();

  const customGoals = selectedGoals.filter((g) => !data.suggestedGoals.includes(g));

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        {/* Agent header */}
        <div className={styles.agentHeader}>
          <div>
            <div className={styles.nameRow}>
              {IconComponent && <span className={styles.icon}><IconComponent /></span>}
              <h1 className={styles.agentName}>{agent.name}</h1>
            </div>
            {(step === 0 || (step === 1 && data.requiresAccounts)) ? (
              <h2 className={styles.greeting}>
                {displayedGreeting}
                <span
                  style={{
                    display: 'inline-block',
                    width: '0.06em',
                    height: '0.9em',
                    background: 'currentColor',
                    marginLeft: '0.08em',
                    verticalAlign: '-0.1em',
                    opacity: isTyping ? 1 : 0,
                    transition: 'opacity 0.2s ease 0.3s',
                  }}
                  aria-hidden="true"
                />
              </h2>
            ) : (
              <p className={styles.stepBadge}>{stepBadge}</p>
            )}
          </div>
        </div>

        {/* ── Step 0 & Step 1: How it works → Connect accounts (morphing layout) ── */}
        {(step === 0 || (step === 1 && data.requiresAccounts)) && (() => {
          const isExpanded = step === 1;

          const flowArrow = (
            <svg width="56" height="10" viewBox="0 0 56 10" fill="none" aria-hidden="true">
              <circle cx="4" cy="5" r="1.6" fill="currentColor" opacity="0.25">
                <animate attributeName="opacity" values="0.25;1;0.25" keyTimes="0;0.25;1" dur="2.4s" begin="0s" repeatCount="indefinite" />
              </circle>
              <circle cx="16" cy="5" r="1.6" fill="currentColor" opacity="0.25">
                <animate attributeName="opacity" values="0.25;1;0.25" keyTimes="0;0.25;1" dur="2.4s" begin="0.35s" repeatCount="indefinite" />
              </circle>
              <circle cx="28" cy="5" r="1.6" fill="currentColor" opacity="0.25">
                <animate attributeName="opacity" values="0.25;1;0.25" keyTimes="0;0.25;1" dur="2.4s" begin="0.7s" repeatCount="indefinite" />
              </circle>
              <path d="M40 1 L46 5 L40 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.35">
                <animate attributeName="opacity" values="0.35;1;0.35" keyTimes="0;0.25;1" dur="2.4s" begin="1.05s" repeatCount="indefinite" />
              </path>
            </svg>
          );

          const cardShellStyle: React.CSSProperties = {
            borderRadius: '20px',
            padding: '36px 28px',
            background: 'var(--card-hover)',
            border: '1px solid var(--border-light)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          };

          const iconWrapperStyle: React.CSSProperties = {
            width: '52px', height: '52px', borderRadius: '14px',
            background: 'var(--bg)', border: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          };

          const stepLabelStyle: React.CSSProperties = {
            fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-dim)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            display: 'block', marginBottom: '10px',
          };

          const titleStyle: React.CSSProperties = {
            fontSize: '1.05rem', fontWeight: 600, color: 'var(--text)',
            margin: '0 0 8px', lineHeight: 1.3,
          };

          const descStyle: React.CSSProperties = {
            fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.6, margin: 0,
          };

          const insights = [
            { skill: 'Subscription Radar', title: 'Spotify charges $9.99 tomorrow', detail: 'From your Amex \u2022\u20228832.' },
            { skill: 'Spending Breakdown', title: 'Dining up 45% this month', detail: '$640 spent \u2014 $200 over your average.' },
            { skill: 'Cash Flow Forecast', title: 'On track for $1,133 surplus', detail: 'Based on current pace through month-end.' },
            { skill: 'Bill Watch', title: 'Internet bill jumped $89 \u2192 $109', detail: 'Rogers increased your plan silently.' },
            { skill: 'Subscription Radar', title: '3 subscriptions unused in 60+ days', detail: 'Hulu, NYT Games, Audible \u2014 $34/mo.' },
          ];

          const sideCardFade: React.CSSProperties = {
            opacity: isExpanded ? 0 : 1,
            maxHeight: isExpanded ? '0px' : '900px',
            minHeight: isExpanded ? 0 : '460px',
            transition: 'opacity 0.3s ease, max-height 0.55s cubic-bezier(0.22, 1, 0.36, 1), min-height 0.55s cubic-bezier(0.22, 1, 0.36, 1)',
            transitionDelay: isExpanded ? '100ms,200ms,200ms' : '600ms,500ms,500ms',
            minWidth: 0,
            overflow: 'hidden',
            pointerEvents: isExpanded ? 'none' : 'auto',
          };

          const arrowFade: React.CSSProperties = {
            opacity: isExpanded ? 0 : 1,
            transition: 'opacity 0.3s ease',
            transitionDelay: isExpanded ? '100ms' : '650ms',
            minWidth: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text)',
            pointerEvents: 'none',
          };

          return (
            <>
              {/* Keyframes for the transaction scroller */}
              <style>{`
                @keyframes artifigenzTxnScroll {
                  from { transform: translateY(0); }
                  to { transform: translateY(-50%); }
                }
              `}</style>

              {/* Top CTA — collapses height AND fades out FIRST when expanding */}
              <div style={{
                overflow: 'hidden',
                maxHeight: isExpanded ? '0px' : '120px',
                marginTop: isExpanded ? '0px' : '8px',
                marginBottom: isExpanded ? '0px' : '8px',
                opacity: isExpanded ? 0 : 1,
                transition: 'max-height 0.45s cubic-bezier(0.22, 1, 0.36, 1), margin-top 0.45s cubic-bezier(0.22, 1, 0.36, 1), margin-bottom 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease',
                transitionDelay: isExpanded ? '0ms' : '850ms',
                pointerEvents: isExpanded ? 'none' : 'auto',
              }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button className={styles.primaryBtn} onClick={next} style={{ padding: '14px 36px', fontSize: '0.9rem' }}>
                    Get started →
                  </button>
                  <Link href="/app" className={styles.ghostBtn} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                    Cancel
                  </Link>
                </div>
              </div>

              {/* Morphing grid — transition column tracks so Card 1 expands smoothly */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isExpanded
                  ? 'minmax(0, 1fr) 0px minmax(0, 0fr) 0px minmax(0, 0fr)'
                  : 'minmax(0, 1fr) 72px minmax(0, 1fr) 72px minmax(0, 1fr)',
                transition: 'grid-template-columns 0.55s cubic-bezier(0.22, 1, 0.36, 1), margin-top 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
                transitionDelay: isExpanded ? '200ms,0ms' : '500ms,850ms',
                gap: 0,
                alignItems: 'stretch',
                marginTop: isExpanded ? '24px' : '64px',
                marginBottom: '48px',
              }}>

                {/* Card 1: Connect — persists, expands to full width on step 1, hugs content */}
                <div style={{
                  ...cardShellStyle,
                  minWidth: 0,
                  overflow: 'hidden',
                  minHeight: isExpanded ? 0 : '460px',
                  transition: 'min-height 0.55s cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: isExpanded ? '200ms' : '500ms',
                }}>
                  <div style={iconWrapperStyle}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/>
                      <path d="M2 10h20"/>
                    </svg>
                  </div>
                  <div style={{ flex: '0 0 auto' }}>
                    <span style={stepLabelStyle}>You connect</span>
                    <h3 style={titleStyle}>Link your bank accounts</h3>
                    {/* Description collapses on step 1 — greeting carries the context */}
                    <div style={{
                      maxHeight: isExpanded ? '0px' : '80px',
                      opacity: isExpanded ? 0 : 1,
                      overflow: 'hidden',
                      transition: 'max-height 0.4s ease, opacity 0.25s ease',
                      transitionDelay: isExpanded ? '300ms,300ms' : '800ms,900ms',
                    }}>
                      <p style={descStyle}>
                        Securely through Plaid. Read-only access. Takes 30 seconds per account.
                      </p>
                    </div>
                  </div>

                  {/* Step 0: mock bank list with fade mask — collapses on step 1 */}
                  <div style={{
                    marginTop: isExpanded ? 0 : 'auto',
                    maxHeight: isExpanded ? '0px' : '180px',
                    opacity: isExpanded ? 0 : 1,
                    overflow: 'hidden',
                    transition: 'max-height 0.4s ease, opacity 0.25s ease, margin-top 0.4s ease',
                    transitionDelay: isExpanded ? '300ms,300ms,300ms' : '800ms,900ms,800ms',
                    WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 100%)',
                    maskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 100%)',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {bankList.map((name) => (
                        <div
                          key={name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '9px 14px',
                            borderRadius: '10px',
                            background: 'var(--bg)',
                            border: '1px solid var(--border-light)',
                            fontSize: '0.75rem',
                          }}
                        >
                          <div style={{
                            width: '24px', height: '24px', borderRadius: '6px',
                            background: 'color-mix(in srgb, var(--bg), var(--text) 8%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.62rem', fontWeight: 700, color: 'var(--text)',
                            flexShrink: 0,
                          }}>
                            {name.charAt(0)}
                          </div>
                          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{name}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Step 1: bank tile grid — collapsed on step 0, expands + fades in on step 1 */}
                  <div style={{
                    maxHeight: isExpanded ? '1200px' : '0px',
                    opacity: isExpanded ? 1 : 0,
                    overflow: 'hidden',
                    transition: 'max-height 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease',
                    transitionDelay: isExpanded ? '800ms,900ms' : '0ms,0ms',
                    pointerEvents: isExpanded ? 'auto' : 'none',
                  }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: '12px',
                    }}>
                      {connectedBanks.map((cb) => (
                        <div
                          key={cb.bank}
                          style={{
                            borderRadius: '14px',
                            padding: '18px 18px 16px',
                            background: 'var(--bg)',
                            border: '1px solid var(--border-light)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '14px',
                            position: 'relative',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: '32px', height: '32px', borderRadius: '9px',
                              background: 'color-mix(in srgb, var(--bg), var(--text) 8%)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)',
                              flexShrink: 0,
                            }}>
                              {cb.bank.charAt(0)}
                            </div>
                            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {cb.bank}
                            </div>
                            <button
                              type="button"
                              aria-label={`Remove ${cb.bank}`}
                              onClick={() => removeBank(cb.bank)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                padding: 0,
                                width: '22px',
                                height: '22px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-dim)',
                                cursor: 'pointer',
                                borderRadius: '6px',
                                flexShrink: 0,
                                transition: 'color 0.15s ease, background 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = 'var(--text)';
                                e.currentTarget.style.background = 'color-mix(in srgb, var(--bg), var(--text) 6%)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'var(--text-dim)';
                                e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {cb.accounts.map((acc) => (
                              <div
                                key={acc.last4}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  fontSize: '0.74rem',
                                  color: 'var(--text-mid)',
                                }}
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.label}</span>
                                <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', fontSize: '0.7rem' }}>
                                  &bull;&bull;{acc.last4}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {/* Add tile — always present, disabled when pool is exhausted */}
                      {connectedBanks.length < MOCK_BANK_POOL.length && (
                        <button
                          type="button"
                          onClick={addNextBank}
                          style={{
                            borderRadius: '14px',
                            padding: '20px 16px',
                            background: 'transparent',
                            border: '1.5px dashed var(--border-light)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            minHeight: '120px',
                            fontFamily: 'inherit',
                            color: 'var(--text)',
                            cursor: 'pointer',
                            transition: 'border-color 0.15s ease, background 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--text)';
                            e.currentTarget.style.background = 'var(--bg)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--border-light)';
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <div style={{
                            width: '34px', height: '34px', borderRadius: '50%',
                            border: '1.5px dashed var(--border-light)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="5" x2="12" y2="19"/>
                              <line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                          </div>
                          <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>
                            {connectedBanks.length === 0 ? 'Connect a bank' : 'Add another bank'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Arrow 1 — collapses & fades */}
                <div style={arrowFade}>
                  {flowArrow}
                </div>

                {/* Card 2: Watch — collapses & fades */}
                <div style={{
                  ...cardShellStyle,
                  ...sideCardFade,
                }}>
                  <div style={iconWrapperStyle}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={stepLabelStyle}>I watch</span>
                    <h3 style={titleStyle}>Every transaction, always</h3>
                    <p style={descStyle}>
                      Subscriptions, spending patterns, price changes, recurring charges — 24/7.
                    </p>
                  </div>
                  {(() => {
                    const transactions = [
                      { label: 'Whole Foods', amount: '$87.43', income: false },
                      { label: 'Netflix', amount: '$22.99', income: false },
                      { label: 'Shell', amount: '$52.00', income: false },
                      { label: 'Payroll deposit', amount: '+$4,200.00', income: true },
                      { label: 'Starbucks', amount: '$6.75', income: false },
                      { label: 'Amazon', amount: '$34.99', income: false },
                      { label: 'TD Mortgage', amount: '$2,100.00', income: false },
                      { label: 'Uber', amount: '$15.40', income: false },
                      { label: 'Spotify', amount: '$9.99', income: false },
                      { label: 'Chipotle', amount: '$12.50', income: false },
                      { label: 'Equinox', amount: '$49.99', income: false },
                      { label: 'Hydro bill', amount: '$89.12', income: false },
                    ];
                    const doubled = [...transactions, ...transactions];
                    return (
                      <div style={{
                        marginTop: 'auto',
                        position: 'relative',
                        height: '180px',
                        overflow: 'hidden',
                        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 70%, transparent 100%)',
                        maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 70%, transparent 100%)',
                      }}>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          animation: 'artifigenzTxnScroll 16s linear infinite',
                        }}>
                          {doubled.map((row, i) => (
                            <div key={i} style={{
                              display: 'flex', alignItems: 'center', gap: '10px',
                              padding: '9px 14px', borderRadius: '10px',
                              background: 'var(--bg)', border: '1px solid var(--border-light)',
                              fontSize: '0.75rem',
                              flexShrink: 0,
                            }}>
                              <span style={{
                                width: '6px', height: '6px', borderRadius: '50%',
                                background: row.income ? '#22c55e' : 'var(--text-dim)',
                                flexShrink: 0,
                              }} />
                              <span style={{ color: 'var(--text)', fontWeight: 500, flex: 1 }}>{row.label}</span>
                              <span style={{
                                color: row.income ? '#22c55e' : 'var(--text-dim)',
                                fontVariantNumeric: 'tabular-nums',
                              }}>
                                {row.amount}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Arrow 2 — collapses & fades */}
                <div style={arrowFade}>
                  {flowArrow}
                </div>

                {/* Card 3: Get — collapses & fades */}
                <div style={{
                  ...cardShellStyle,
                  ...sideCardFade,
                }}>
                  <div style={iconWrapperStyle}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                      <path d="M13.73 21a2 2 0 01-3.46 0"/>
                    </svg>
                  </div>
                  <div>
                    <span style={stepLabelStyle}>You receive</span>
                    <h3 style={titleStyle}>Insights that save you money</h3>
                    <p style={descStyle}>
                      In-app, email, or Telegram — wherever you want them.
                    </p>
                  </div>
                  <div style={{
                    position: 'relative',
                    height: '110px',
                    marginTop: 'auto',
                  }}>
                    {insights.map((insight, i) => {
                      const depth = ((i - shuffleIndex) % insights.length + insights.length) % insights.length;
                      const isActive = depth === 0;
                      const isVisible = depth <= 2;
                      const tintPct = 3 + depth * 2;
                      const cardBg = `color-mix(in srgb, var(--bg), var(--text) ${tintPct}%)`;
                      return (
                        <div
                          key={i}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            padding: '14px 16px',
                            borderRadius: '12px',
                            background: cardBg,
                            border: '1px solid var(--border-light)',
                            boxShadow: isActive
                              ? '0 8px 24px rgba(0,0,0,0.1)'
                              : '0 3px 14px rgba(0,0,0,0.04)',
                            transform: `translateY(${depth * 8}px) scale(${1 - depth * 0.035})`,
                            opacity: isVisible ? 1 : 0,
                            zIndex: insights.length - depth,
                            transition: 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.6s ease, box-shadow 0.6s ease, background 0.6s ease',
                            pointerEvents: 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--text)' }} />
                            <span style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              {insight.skill}
                            </span>
                          </div>
                          <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 2px', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {insight.title}
                          </p>
                          <p style={{ fontSize: '0.68rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {insight.detail}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Bottom CTA — appears LAST when moving to step 1 (Back + Activate) */}
              <div style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                justifyContent: 'space-between',
                opacity: isExpanded ? 1 : 0,
                transition: 'opacity 0.3s ease',
                transitionDelay: isExpanded ? '1050ms' : '0ms',
                pointerEvents: isExpanded ? 'auto' : 'none',
                marginTop: '8px',
              }}>
                <button className={styles.ghostBtn} onClick={back}>
                  ← Back
                </button>
                <button
                  className={styles.primaryBtn}
                  onClick={next}
                  disabled={connectedBanks.length === 0}
                  style={{
                    padding: '14px 36px',
                    fontSize: '0.9rem',
                    opacity: connectedBanks.length === 0 ? 0.4 : 1,
                    cursor: connectedBanks.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  Activate {agent.name} →
                </button>
              </div>
            </>
          );
        })()}

        {/* ── Step 2: Set goals ── */}
        {step === 2 && (
          <>
            <h2 className={styles.stepTitle}>What are you trying to accomplish?</h2>
            <p className={styles.stepSubtitle}>
              Pick anything that sounds right — or add your own. I&apos;ll use these to focus my work.
            </p>

            <div className={styles.chipsGroup}>
              <span className={styles.chipsLabel}>Suggested</span>
              <div className={styles.chips}>
                {data.suggestedGoals.map((goal) => {
                  const active = selectedGoals.includes(goal);
                  return (
                    <button
                      key={goal}
                      className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                      onClick={() => toggleGoal(goal)}
                    >
                      {active ? '✓' : '+'} {goal}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.addGoalRow}>
              <input
                className={styles.addGoalInput}
                placeholder="Add your own goal..."
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomGoal()}
              />
              <button className={styles.addGoalBtn} onClick={addCustomGoal}>
                Add
              </button>
            </div>

            {customGoals.length > 0 && (
              <div className={styles.chipsGroup}>
                <span className={styles.chipsLabel}>Your goals</span>
                <div className={styles.chips}>
                  {customGoals.map((goal) => (
                    <span key={goal} className={`${styles.chip} ${styles.chipCustom}`}>
                      {goal}
                      <button
                        className={styles.chipRemove}
                        onClick={() => removeGoal(goal)}
                        aria-label={`Remove ${goal}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.footer}>
              <button className={styles.ghostBtn} onClick={back}>
                Back
              </button>
              <button className={styles.primaryBtn} onClick={next}>
                Continue →
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Review & start ── */}
        {step === 3 && (
          <>
            <h2 className={styles.stepTitle}>Ready to go</h2>
            <p className={styles.stepSubtitle}>
              Here&apos;s what I&apos;ll start with. You can change any of this later from the dashboard.
            </p>

            <div className={styles.summaryCard}>
              {data.requiresAccounts && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Accounts</span>
                  <span className={styles.summaryValue}>
                    {connectedAccountNames.length > 0
                      ? connectedAccountNames.join(', ')
                      : 'None — you can connect later'}
                  </span>
                </div>
              )}

              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Goals</span>
                <span className={styles.summaryValue}>
                  {selectedGoals.length > 0
                    ? selectedGoals.join(' · ')
                    : 'None set'}
                </span>
              </div>

              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Skills</span>
                <button
                  className={styles.skillsSummary}
                  onClick={() => setSkillsExpanded(!skillsExpanded)}
                >
                  {activeSkillCount} of {data.skills.length} active {skillsExpanded ? '▴' : '▾'}
                </button>
              </div>

              {skillsExpanded && (
                <div className={styles.skillsList}>
                  {data.skills.map((skill) => {
                    const isActive = activeSkills[skill.name];
                    return (
                      <div key={skill.name} className={styles.skillItem}>
                        <span className={isActive ? '' : styles.skillInactive}>
                          {skill.name}
                        </span>
                        <div
                          className={`${styles.toggle} ${isActive ? styles.toggleOn : ''}`}
                          onClick={() => toggleSkill(skill.name)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className={styles.toggleDot} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={styles.footer}>
              <button className={styles.ghostBtn} onClick={back}>
                Back
              </button>
              <button className={styles.primaryBtn} onClick={next}>
                Activate {agent.name} →
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
