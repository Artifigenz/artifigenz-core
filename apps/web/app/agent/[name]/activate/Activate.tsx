'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import Header from '@/components/layout/Header';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { AGENTS } from '@artifigenz/shared';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import { useApiClient } from '@/hooks/useApiClient';
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
  pitch: string;
  capabilities: Capability[];
  channels: ChannelSamples;
  requiresAccounts: boolean;
  accountOptions: AccountOption[];
  suggestedGoals: string[];
  skills: ActivationSkill[];
  estimatedSetupSeconds: number;
}

const ACTIVATION_DATA: Record<string, ActivationData> = {
  finance: {
    tagline: "I watch your money so you don't have to.",
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
  return (
    <ProtectedRoute>
      <ActivateContent params={params} />
    </ProtectedRoute>
  );
}

function ActivateContent({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const router = useRouter();
  const { activate, finalizeActivation } = useActivatedAgents();
  const api = useApiClient();
  const slug = name.toLowerCase();
  const agent = AGENTS.find((a) => a.name.toLowerCase().replace(/\s+/g, '-') === slug);
  const data = ACTIVATION_DATA[slug];
  const IconComponent = agent ? ICON_MAP[agent.name] : undefined;

  const [step, setStep] = useState(0);
  const [connectedAccounts, setConnectedAccounts] = useState<string[]>([]);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);

  // ─── Plaid + Upload state ─────────────────────────────────────
  const [agentInstanceId, setAgentInstanceId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState<'choose' | 'plaid' | 'upload'>('choose');
  const [connectedBanks, setConnectedBanks] = useState<Array<{ name: string; id: string }>>([]);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; transactions: number }>>([]);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Plaid Link hook ──────────────────────────────────────────
  const onPlaidSuccess = useCallback(
    async (publicToken: string, metadata: { institution: { name: string; institution_id: string } | null }) => {
      if (!agentInstanceId) return;
      setPlaidLoading(true);
      setConnectError(null);
      try {
        await api.post(`/api/me/agents/${agentInstanceId}/connections/plaid/finalize`, {
          publicToken,
          metadata: {
            institutionName: metadata.institution?.name ?? 'Bank Account',
            institutionId: metadata.institution?.institution_id,
          },
        });
        setConnectedBanks((prev) => [
          ...prev,
          { name: metadata.institution?.name ?? 'Bank Account', id: publicToken.slice(0, 8) },
        ]);
        setLinkToken(null);

        // Sync transactions + run skill inline (~10-15s in sandbox)
        setConnectError(null);
        setPlaidLoading(true);
        try {
          const syncResult = await api.syncAgent(agentInstanceId);
          setConnectedBanks((prev) =>
            prev.map((b) =>
              b.id === publicToken.slice(0, 8)
                ? { ...b, name: `${b.name} (${syncResult.transactions} transactions)` }
                : b,
            ),
          );
        } catch {
          // Sync failure is non-fatal — transactions will be available later
        }
      } catch (err) {
        setConnectError(err instanceof Error ? err.message : 'Failed to connect bank');
      } finally {
        setPlaidLoading(false);
      }
    },
    [agentInstanceId, api],
  );

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken ?? '',
    onSuccess: onPlaidSuccess,
    onExit: () => {
      setPlaidLoading(false);
      setLinkToken(null);
    },
  });

  useEffect(() => {
    if (linkToken && plaidReady) {
      openPlaid();
    }
  }, [linkToken, plaidReady, openPlaid]);

  const startPlaidConnect = async () => {
    if (!agentInstanceId) return;
    setPlaidLoading(true);
    setConnectError(null);
    try {
      const res = await api.post<{ linkToken: string }>(
        `/api/me/agents/${agentInstanceId}/connections/plaid/init`,
      );
      setLinkToken(res.linkToken);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to initialize connection');
      setPlaidLoading(false);
    }
  };

  // ─── File upload handler ──────────────────────────────────────
  const handleFileUpload = async (file: File) => {
    setUploadLoading(true);
    setConnectError(null);
    try {
      if (slug === 'health') {
        const fd = new FormData();
        fd.append('file', file);
        const result = await api.uploadHealthFile(fd);
        setUploadedFiles((prev) => [...prev, { name: file.name, transactions: result.metrics }]);
      } else {
        const result = await api.uploadFile((() => {
          const fd = new FormData();
          fd.append('file', file);
          return fd;
        })());
        setUploadedFiles((prev) => [...prev, { name: file.name, transactions: result.transactions }]);
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  };
  const [newGoal, setNewGoal] = useState('');
  const [activeSkills, setActiveSkills] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    (data?.skills ?? []).forEach((s) => {
      init[s.name] = true;
    });
    return init;
  });
  const [skillsExpanded, setSkillsExpanded] = useState(false);

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

  const toggleAccount = (acctName: string) => {
    setConnectedAccounts((prev) =>
      prev.includes(acctName) ? prev.filter((n) => n !== acctName) : [...prev, acctName]
    );
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

  const next = async () => {
    if (step === 0) {
      // Create agent instance in 'onboarding' status so it doesn't appear
      // on the dashboard yet. Plaid Link + upload need the instance ID.
      if (data.requiresAccounts && !agentInstanceId) {
        try {
          const instanceId = await activate({
            slug,
            activatedAt: Date.now(),
            accounts: [],
            goals: [],
            skills: activeSkills,
            status: 'onboarding',
          });
          if (instanceId) {
            setAgentInstanceId(instanceId);
          } else {
            // Fallback: fetch from API
            const agents = await api.getMyAgents();
            const inst = agents.find((a: { agentTypeId: string }) => a.agentTypeId === slug);
            if (inst) setAgentInstanceId(inst.id);
          }
        } catch {
          try {
            const agents = await api.getMyAgents();
            const inst = agents.find((a: { agentTypeId: string }) => a.agentTypeId === slug);
            if (inst) setAgentInstanceId(inst.id);
          } catch {
            // Continue without ID
          }
        }
      }
      setStep(data.requiresAccounts ? 1 : 2);
    } else if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      // Finalize: flip status from 'onboarding' to 'active'
      if (agentInstanceId) {
        await finalizeActivation(slug, agentInstanceId, {
          slug,
          activatedAt: Date.now(),
          agentInstanceId,
          accounts: connectedAccounts,
          goals: selectedGoals,
          skills: activeSkills,
        });
        // Update goal if set
        if (selectedGoals.length > 0) {
          await api.updateAgentInstance(agentInstanceId, {
            goal: selectedGoals.join('; '),
            status: 'active',
          });
        }
      }
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
        <Link href="/app" className={styles.back} aria-label="Back">←</Link>

        {/* Agent header */}
        <div className={styles.agentHeader}>
          <div>
            <div className={styles.nameRow}>
              {IconComponent && <span className={styles.icon}><IconComponent /></span>}
              <h1 className={styles.agentName}>{agent.name}</h1>
            </div>
            {step === 0 ? (
              <p className={styles.tagline}>{data.tagline}</p>
            ) : (
              <p className={styles.stepBadge}>{stepBadge}</p>
            )}
          </div>
        </div>

        {/* ── Step 0: Selling page ── */}
        {step === 0 && (
          <>
            <p className={styles.pitch}>{data.pitch}</p>

            <div className={styles.ctaRow}>
              <button className={styles.primaryBtn} onClick={next}>
                Get started →
              </button>
              <span className={styles.ctaHint}>
                Ready in ~{data.estimatedSetupSeconds} seconds
              </span>
            </div>

            <div className={styles.capabilitiesSection}>
              <span className={styles.sectionLabel}>Skills</span>
              <div className={styles.capabilitiesGrid}>
                {data.capabilities.map((cap) => {
                  const CapIcon = CAPABILITY_ICON_MAP[cap.icon];
                  return (
                    <div key={cap.label} className={styles.capabilityItem}>
                      {CapIcon && (
                        <span className={styles.capabilityIcon}>
                          <CapIcon />
                        </span>
                      )}
                      <div className={styles.capabilityText}>
                        <span className={styles.capabilityLabel}>{cap.label}</span>
                        <span className={styles.capabilityDesc}>{cap.description}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.previewSection}>
              <h3 className={styles.previewHeading}>Here&apos;s what you&apos;ll get.</h3>
              <div className={styles.mockupGrid}>
                {/* In-app insight mockup */}
                <div className={styles.mockupCard}>
                  <span className={styles.mockupLabel}>In-app</span>
                  <div className={styles.screenshotFrame}>
                    <div className={styles.screenshotChrome}>
                      <span className={styles.screenshotDot} />
                      <span className={styles.screenshotDot} />
                      <span className={styles.screenshotDot} />
                      <span className={styles.chromeLogo}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/logo_transparent.png" alt="Artifigenz" width={18} height={18} />
                      </span>
                    </div>
                    <div className={styles.screenshotBody}>
                      <div className={styles.insightMockupTop}>
                        <span className={styles.insightMockupCategory}>
                          <span className={styles.insightMockupCategoryDot} />
                          {data.channels.insight.category}
                        </span>
                        {data.channels.insight.mustSee && (
                          <span className={styles.insightMockupFlag}>Must see ⚠</span>
                        )}
                      </div>
                      <p className={styles.insightMockupTitle}>{data.channels.insight.title}</p>
                      <p className={styles.insightMockupDetail}>{data.channels.insight.detail}</p>
                    </div>
                  </div>
                </div>

                {/* Telegram mockup */}
                <div className={styles.mockupCard}>
                  <span className={styles.mockupLabel}>Telegram</span>
                  <div className={styles.screenshotFrame}>
                    <div className={styles.screenshotChrome}>
                      <span className={styles.screenshotDot} />
                      <span className={styles.screenshotDot} />
                      <span className={styles.screenshotDot} />
                      <span className={styles.chromeLogo} aria-label="Telegram">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#2a7dc4" stroke="none">
                          <path d="M22 2 11 13 2 9l20-7zm0 0-7 20-4-9" fill="none" stroke="#2a7dc4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>
                    <div className={styles.screenshotBody}>
                      <div className={styles.telegramRow}>
                        <div className={styles.telegramAvatar}>A</div>
                        <div className={styles.telegramContent}>
                          <div className={styles.telegramName}>Artifigenz</div>
                          <div className={styles.telegramBubble}>
                            {data.channels.telegram.text}
                          </div>
                          <div className={styles.telegramTime}>{data.channels.telegram.timestamp}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Email mockup */}
                <div className={styles.mockupCard}>
                  <span className={styles.mockupLabel}>Email</span>
                  <div className={styles.screenshotFrame}>
                    <div className={styles.screenshotChrome}>
                      <span className={styles.screenshotDot} />
                      <span className={styles.screenshotDot} />
                      <span className={styles.screenshotDot} />
                      <span className={styles.chromeLogo} aria-label="Email">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </svg>
                      </span>
                    </div>
                    <div className={styles.screenshotBody}>
                      <div className={styles.emailHeader}>
                        <div className={styles.emailSenderIcon}>A</div>
                        <div className={styles.emailSenderInfo}>
                          <div className={styles.emailSenderName}>Artifigenz</div>
                          <div className={styles.emailTime}>{data.channels.email.timestamp} ago</div>
                        </div>
                      </div>
                      <div className={styles.emailSubject}>{data.channels.email.subject}</div>
                      <div className={styles.emailPreview}>{data.channels.email.preview}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Step 1: Connect accounts ── */}
        {step === 1 && data.requiresAccounts && slug === 'health' && (
          <>
            <h2 className={styles.stepTitle}>Upload your health data</h2>
            <p className={styles.stepSubtitle}>
              Export your data from Apple Health and upload it here. We&apos;ll extract sleep, steps, heart rate, workouts, and more.
            </p>

            {connectError && (
              <p style={{ fontSize: '0.78rem', color: '#c44', marginBottom: '16px' }}>{connectError}</p>
            )}

            {/* ── Apple Health Export ── */}
            <div
              style={{
                border: '1px solid var(--border-light)',
                borderRadius: '14px',
                padding: '24px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '16px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>
                </div>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>
                    Apple Health Export
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.55 }}>
                    Open the <strong style={{ color: 'var(--text)' }}>Health</strong> app on your iPhone &rarr; tap your profile icon (top right) &rarr; <strong style={{ color: 'var(--text)' }}>Export All Health Data</strong>.
                    Upload the <code style={{ fontSize: '0.75rem', background: 'var(--card-hover)', padding: '1px 5px', borderRadius: '4px' }}>export.xml</code> file here.
                  </p>
                </div>
              </div>

              <div style={{ background: 'var(--card-hover)', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--text)' }}>What we extract:</strong> Steps, sleep duration, resting heart rate, HRV, workouts, active calories, distance, flights climbed, and weight.
                  All data stays private and is only used for your personal insights.
                </p>
              </div>

              {/* Uploaded files list */}
              {uploadedFiles.map((file, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    background: 'var(--card-hover)',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    fontSize: '0.82rem',
                    color: 'var(--text)',
                  }}
                >
                  <span style={{ color: '#22c55e' }}>&#10003;</span>
                  {file.name}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginLeft: 'auto' }}>
                    {file.transactions} metrics
                  </span>
                </div>
              ))}

              <input
                ref={fileInputRef}
                type="file"
                accept=".xml,.csv,.txt,.pdf,.jpg,.jpeg,.png,.webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLoading || !agentInstanceId}
                style={{
                  fontFamily: 'inherit',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  color: 'var(--accent-text)',
                  background: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  padding: '9px 18px',
                  borderRadius: '9999px',
                  cursor: uploadLoading ? 'not-allowed' : 'pointer',
                  opacity: uploadLoading ? 0.5 : 1,
                  marginTop: uploadedFiles.length > 0 ? '8px' : '0',
                }}
              >
                {uploadLoading
                  ? 'Analyzing your health data...'
                  : uploadedFiles.length > 0
                    ? '+ Upload another file'
                    : 'Upload export.xml \u2192'}
              </button>
            </div>

            <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
              Also works with CSV exports from Fitbit, Google Fit, Oura, and other health apps. Screenshots of health dashboards work too.
            </p>

            <div className={styles.footer}>
              <button className={styles.ghostBtn} onClick={next}>
                {uploadedFiles.length === 0 ? 'Skip for now' : 'Continue \u2192'}
              </button>
              {uploadedFiles.length > 0 && (
                <button className={styles.primaryBtn} onClick={next}>
                  Continue &rarr;
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Step 1: Connect accounts (finance / other) ── */}
        {step === 1 && data.requiresAccounts && slug !== 'health' && (
          <>
            <h2 className={styles.stepTitle}>Connect your financial data</h2>
            <p className={styles.stepSubtitle}>
              Choose how you&apos;d like to share your transaction history. You can always add more accounts later.
            </p>

            {connectError && (
              <p style={{ fontSize: '0.78rem', color: '#c44', marginBottom: '16px' }}>{connectError}</p>
            )}

            {/* ── Option A: Plaid ── */}
            <div
              style={{
                border: '1px solid var(--border-light)',
                borderRadius: '14px',
                padding: '24px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '12px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
                </div>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>
                    Connect a bank account
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.55 }}>
                    Securely link your bank through <strong style={{ color: 'var(--text)' }}>Plaid</strong> — the same service trusted by Venmo, Robinhood, and thousands of financial apps.
                    We never see your login credentials. Read-only access to transactions only.
                  </p>
                </div>
              </div>

              {/* Connected banks list */}
              {connectedBanks.map((bank) => (
                <div
                  key={bank.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    background: 'var(--card-hover)',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    fontSize: '0.82rem',
                    color: 'var(--text)',
                  }}
                >
                  <span style={{ color: '#22c55e' }}>&#10003;</span>
                  {bank.name}
                </div>
              ))}

              <button
                onClick={startPlaidConnect}
                disabled={plaidLoading || !agentInstanceId}
                style={{
                  fontFamily: 'inherit',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  color: 'var(--accent-text)',
                  background: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  padding: '9px 18px',
                  borderRadius: '9999px',
                  cursor: plaidLoading ? 'not-allowed' : 'pointer',
                  opacity: plaidLoading ? 0.5 : 1,
                  marginTop: connectedBanks.length > 0 ? '8px' : '0',
                }}
              >
                {plaidLoading
                  ? 'Connecting...'
                  : connectedBanks.length > 0
                    ? '+ Add another bank'
                    : 'Connect bank \u2192'}
              </button>
            </div>

            {/* ── Divider ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '8px 0' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border-light)' }} />
              <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>or</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border-light)' }} />
            </div>

            {/* ── Option B: Upload ── */}
            <div
              style={{
                border: '1px dashed var(--border-light)',
                borderRadius: '14px',
                padding: '24px',
                marginTop: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '12px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>
                    Upload bank statements
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.55 }}>
                    Upload PDF, CSV, or image files from any bank. Our AI reads the document and extracts your transactions automatically.
                  </p>
                </div>
              </div>

              {/* Uploaded files list */}
              {uploadedFiles.map((file, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    background: 'var(--card-hover)',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    fontSize: '0.82rem',
                    color: 'var(--text)',
                  }}
                >
                  <span style={{ color: '#22c55e' }}>&#10003;</span>
                  {file.name}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginLeft: 'auto' }}>
                    {file.transactions} transactions
                  </span>
                </div>
              ))}

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLoading || !agentInstanceId}
                style={{
                  fontFamily: 'inherit',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  color: 'var(--text)',
                  background: 'transparent',
                  border: '1px solid var(--border-light)',
                  padding: '9px 18px',
                  borderRadius: '9999px',
                  cursor: uploadLoading ? 'not-allowed' : 'pointer',
                  opacity: uploadLoading ? 0.5 : 1,
                  marginTop: uploadedFiles.length > 0 ? '8px' : '0',
                }}
              >
                {uploadLoading
                  ? 'Analyzing... (~30s)'
                  : uploadedFiles.length > 0
                    ? '+ Upload another file'
                    : 'Choose file \u2192'}
              </button>
            </div>

            <div className={styles.footer}>
              <button className={styles.ghostBtn} onClick={next}>
                {connectedBanks.length === 0 && uploadedFiles.length === 0 ? 'Skip for now' : 'Continue \u2192'}
              </button>
              {(connectedBanks.length > 0 || uploadedFiles.length > 0) && (
                <button className={styles.primaryBtn} onClick={next}>
                  Continue &rarr;
                </button>
              )}
            </div>
          </>
        )}

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
                    {connectedAccounts.length > 0
                      ? connectedAccounts.join(', ')
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
