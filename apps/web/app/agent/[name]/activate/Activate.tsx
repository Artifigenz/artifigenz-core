'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import { AGENTS } from '@artifigenz/shared';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import * as Icons from '@/components/sections/AgentIcons';
import styles from './page.module.css';

const ICON_MAP: Record<string, React.ComponentType> = {
  Finance: Icons.FinanceIcon,
  Travel: Icons.TravelIcon,
  Health: Icons.HealthIcon,
  Research: Icons.ResearchIcon,
  'Job Search': Icons.JobSearchIcon,
};

interface Capability {
  label: string;
  description: string;
}

interface SampleInsight {
  category: string;
  title: string;
  detail: string;
  mustSee?: boolean;
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
  sampleInsights: SampleInsight[];
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
      { label: 'Spot forgotten subscriptions', description: 'Every recurring charge across all accounts, in one place.' },
      { label: 'Catch bill increases', description: 'Notice the moment a subscription quietly raises its price.' },
      { label: 'Flag unusual spending', description: 'When a category creeps above your average, I tell you why.' },
      { label: 'Forecast your month', description: "Always-on cash flow projection based on what's already booked." },
    ],
    sampleInsights: [
      { category: 'Bill Change', title: 'Netflix increased by 48%', detail: '$15.49/mo → $22.99/mo. This adds $90/year to your subscriptions.', mustSee: true },
      { category: 'Spending', title: 'Food & Dining is $200 above your average', detail: '$640 this month vs. $440 average. Most of the increase is DoorDash.' },
    ],
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
      { label: 'Track fares automatically', description: 'Set destinations once; I watch prices 24/7.' },
      { label: 'Alert on deal windows', description: 'Know the moment flights drop for your dates.' },
      { label: 'Build itineraries fast', description: 'Flights, hotels, and activities in one flow.' },
      { label: 'Flag visa & passport issues', description: 'Never get blindsided at the airport.' },
    ],
    sampleInsights: [
      { category: 'Price Drop', title: 'Tokyo flights dropped 34% for April 12–19', detail: 'Round-trip from JFK now $287. Lowest in 90 days.', mustSee: true },
      { category: 'Document', title: 'Passport expires in 4 months', detail: 'Some countries require 6 months validity. Consider renewing.', mustSee: true },
    ],
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
      { label: 'Spot sleep trends early', description: 'Catch patterns in your rest before they become chronic.' },
      { label: 'Track activity streaks', description: 'Gentle nudges when your movement drops off.' },
      { label: 'Monitor hydration', description: 'Simple daily check-ins, no guilt trips.' },
      { label: 'Connect habits to outcomes', description: 'Understand what actually moves your numbers.' },
    ],
    sampleInsights: [
      { category: 'Sleep', title: 'Sleep dropped below 6h three nights this week', detail: '14-day average: 5.2 hrs. Your baseline is 7.1 hrs.', mustSee: true },
      { category: 'Activity', title: 'Step count is up 12% since last month', detail: '8,420 avg daily steps vs. 7,520 last month.' },
    ],
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
      { label: 'Daily topic scans', description: 'New papers, news, and posts filtered to what you care about.' },
      { label: 'Competitor watching', description: 'Know when your rivals ship, price-change, or pivot.' },
      { label: 'Clean summaries', description: 'Every report distilled to what you actually need to know.' },
      { label: 'Trend spotting', description: "Catch shifts in your space before they're obvious." },
    ],
    sampleInsights: [
      { category: 'Report', title: 'Competitive analysis ready — 12 pages', detail: '5 competitors analyzed: positioning, pricing, feature gaps.', mustSee: true },
      { category: 'Papers', title: '3 new papers on AI agent adoption', detail: 'Published in the last 14 days. Consumer trust, onboarding, retention.' },
    ],
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
      { label: 'Match roles automatically', description: 'New postings filtered to your skills and ambitions.' },
      { label: 'Track applications', description: 'Know where every submission stands, no spreadsheet needed.' },
      { label: 'Benchmark salaries', description: "Real numbers for the roles you're targeting." },
      { label: 'Spot warm intros', description: 'Notice when someone you know joins a target company.' },
    ],
    sampleInsights: [
      { category: 'New Roles', title: '3 new roles matching your profile', detail: 'Senior PM at Anthropic, Staff PM at OpenAI, Head of Product at Cohere. All remote-friendly.', mustSee: true },
      { category: 'Application', title: 'Stripe application moved to interview', detail: 'Interview invite expected within 48 hours.', mustSee: true },
    ],
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
  const slug = name.toLowerCase();
  const agent = AGENTS.find((a) => a.name.toLowerCase().replace(/\s+/g, '-') === slug);
  const data = ACTIVATION_DATA[slug];
  const IconComponent = agent ? ICON_MAP[agent.name] : undefined;

  const [step, setStep] = useState(0);
  const [connectedAccounts, setConnectedAccounts] = useState<string[]>([]);
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

  if (!agent) {
    return (
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Link href="/explore" className={styles.back}>← Back</Link>
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
          <Link href="/explore" className={styles.back}>← Back to explore</Link>
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

  const next = () => {
    if (step === 0) setStep(data.requiresAccounts ? 1 : 2);
    else if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3) {
      activate({
        slug,
        activatedAt: Date.now(),
        accounts: connectedAccounts,
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
        <Link href="/explore" className={styles.back}>← Back to explore</Link>

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

            <div className={styles.capabilitiesSection}>
              <span className={styles.sectionLabel}>What I&apos;ll do for you</span>
              <div className={styles.capabilitiesGrid}>
                {data.capabilities.map((cap) => (
                  <div key={cap.label} className={styles.capabilityItem}>
                    <span className={styles.capabilityLabel}>{cap.label}</span>
                    <span className={styles.capabilityDesc}>{cap.description}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.previewSection}>
              <span className={styles.sectionLabel}>What your dashboard will look like</span>
              <div className={styles.timelineCards}>
                {data.sampleInsights.map((insight) => (
                  <div key={insight.title} className={styles.insightCard}>
                    <div className={styles.insightTop}>
                      <span className={styles.insightCategory}>
                        <span className={styles.insightDot} />
                        {insight.category}
                      </span>
                      {insight.mustSee && <span className={styles.mustSee}>Must see ⚠</span>}
                    </div>
                    <p className={styles.insightTitle}>{insight.title}</p>
                    <p className={styles.insightDetail}>{insight.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.ctaRow}>
              <button className={styles.primaryBtn} onClick={next}>
                Get started →
              </button>
              <span className={styles.ctaHint}>
                Ready in ~{data.estimatedSetupSeconds} seconds
              </span>
            </div>
          </>
        )}

        {/* ── Step 1: Connect accounts ── */}
        {step === 1 && data.requiresAccounts && (
          <>
            <h2 className={styles.stepTitle}>Connect your accounts</h2>
            <p className={styles.stepSubtitle}>
              I need access to these so I can pull your data. Read-only, always.
            </p>

            <div className={styles.configList}>
              {data.accountOptions.map((opt) => {
                const isConnected = connectedAccounts.includes(opt.name);
                return (
                  <div key={opt.name} className={styles.accountItem}>
                    <div className={styles.accountInfo}>
                      <span className={styles.accountName}>{opt.name}</span>
                      <span className={styles.accountDesc}>{opt.description}</span>
                    </div>
                    <button
                      className={isConnected ? styles.connectedBtn : styles.connectBtn}
                      onClick={() => toggleAccount(opt.name)}
                    >
                      {isConnected ? '✓ Connected' : 'Connect'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className={styles.footer}>
              <button className={styles.ghostBtn} onClick={next}>
                Skip for now
              </button>
              <button className={styles.primaryBtn} onClick={next}>
                Continue →
              </button>
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
