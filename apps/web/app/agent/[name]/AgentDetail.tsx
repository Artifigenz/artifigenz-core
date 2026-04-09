'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import ChatInput from '@/components/sections/ChatInput';
import { AGENTS } from '@artifigenz/shared';
import { useActivatedAgents, agentSlug } from '@/hooks/useActivatedAgents';
import { buildGreeting } from '@/lib/greeting';
import * as Icons from '@/components/sections/AgentIcons';
import styles from './page.module.css';

const ICON_MAP: Record<string, React.ComponentType> = {
  Finance: Icons.FinanceIcon,
  Travel: Icons.TravelIcon,
  Health: Icons.HealthIcon,
  Research: Icons.ResearchIcon,
  'Job Search': Icons.JobSearchIcon,
};

interface Insight {
  category: string;
  title: string;
  detail: string;
  mustSee?: boolean;
  read?: boolean;
}

interface Skill {
  name: string;
  active: boolean;
}

interface Account {
  name: string;
}

interface Goal {
  id: string;
  text: string;
}

interface AgentPageData {
  since: string;
  lastAnalyzed: string;
  accounts: Account[];
  goals: Goal[];
  skills: Skill[];
  statsTitle: string;
  stats: { value: string; label: string }[];
  unread: number;
  timeline: { date: string; insights: Insight[] }[];
}

const AGENT_DATA: Record<string, AgentPageData> = {
  finance: {
    since: 'March 15',
    lastAnalyzed: '2 hours ago',
    accounts: [{ name: 'Chase ••••4521' }, { name: 'Amex ••••8832' }],
    goals: [
      { id: '1', text: 'Save $500 per month' },
      { id: '2', text: 'Understand where my money goes' },
      { id: '3', text: 'Stop wasting on unused subscriptions' },
    ],
    skills: [
      { name: 'Recurring Charges', active: true },
      { name: 'Spending Breakdown', active: true },
      { name: 'Bill Change Detection', active: true },
      { name: 'New Charge Detection', active: true },
      { name: 'Cash Flow Forecast', active: false },
      { name: 'Income vs. Spending', active: false },
    ],
    statsTitle: 'Financial Health',
    stats: [
      { value: '$5,200', label: 'Income this month' },
      { value: '$3,680', label: 'Spent so far' },
      { value: '$387', label: 'Recurring charges' },
      { value: '$1,133', label: 'Projected surplus' },
    ],
    unread: 3,
    timeline: [
      { date: 'Today', insights: [
        { category: 'Bill Change', title: 'Netflix increased by 48%', detail: '$15.49/mo → $22.99/mo. This adds $90/year to your subscriptions.', mustSee: true },
        { category: 'Spending', title: 'Food & Dining is $200 above your average', detail: '$640 this month vs. $440 average. Most of the increase is DoorDash ($280 vs. usual $120).' },
      ]},
      { date: 'Fri, Mar 28', insights: [
        { category: 'New Charge', title: 'Hulu — $12.99/month', detail: 'First charge on Amex ••8832. Your total subscriptions are now $400/mo across 15 services.', mustSee: true },
      ]},
      { date: 'Thu, Mar 20', insights: [
        { category: 'Recurring Charges', title: '14 subscriptions — $387/month total', detail: 'Full list of all recurring charges across both accounts.', read: true },
        { category: 'Cash Flow', title: 'Projected surplus: ~$340 by month end', detail: 'Income: $5,200. Spent: $3,680. Remaining recurring: $1,180.', read: true },
      ]},
      { date: 'Sat, Mar 1', insights: [
        { category: 'Monthly Report', title: 'February: $5,200 in, $4,800 out, $400 surplus', detail: 'Full spending breakdown by category with month-over-month changes.', read: true },
      ]},
    ],
  },
  travel: {
    since: 'March 10',
    lastAnalyzed: '18 minutes ago',
    accounts: [{ name: 'Google Flights' }, { name: 'Kayak alerts' }],
    goals: [
      { id: '1', text: 'Find deals to Tokyo, Bali, or Florida' },
      { id: '2', text: 'Stay under $2,000 per trip' },
    ],
    skills: [
      { name: 'Price Tracking', active: true },
      { name: 'Deal Alerts', active: true },
      { name: 'Itinerary Builder', active: true },
      { name: 'Visa Requirements', active: false },
      { name: 'Hotel Comparison', active: false },
    ],
    statsTitle: 'Travel Dashboard',
    stats: [
      { value: '3', label: 'Destinations tracked' },
      { value: '$287', label: 'Best flight found' },
      { value: '34%', label: 'Below avg price' },
      { value: '2', label: 'Alerts pending' },
    ],
    unread: 2,
    timeline: [
      { date: 'Today', insights: [
        { category: 'Price Drop', title: 'Tokyo flights dropped 34% for April 12–19', detail: 'Round-trip from JFK now $287. Lowest in 90 days.', mustSee: true },
      ]},
      { date: 'Sat, Mar 29', insights: [
        { category: 'Availability', title: 'Your usual hotel in Bali opened March availability', detail: 'The Mulia Resort · $189/night · 4 rooms left for your preferred dates.', read: true },
      ]},
      { date: 'Wed, Mar 26', insights: [
        { category: 'Document', title: 'Passport expires in 4 months', detail: 'Some countries require 6 months validity. Consider renewing before booking.', mustSee: true },
      ]},
    ],
  },
  health: {
    since: 'March 8',
    lastAnalyzed: '1 hour ago',
    accounts: [{ name: 'Apple Health' }, { name: 'Fitbit sync' }],
    goals: [
      { id: '1', text: 'Get sleep back above 7 hours' },
      { id: '2', text: 'Maintain step count above 8,000/day' },
      { id: '3', text: 'Drink 8 glasses of water daily' },
    ],
    skills: [
      { name: 'Sleep Analysis', active: true },
      { name: 'Step Tracking', active: true },
      { name: 'Hydration', active: true },
      { name: 'Nutrition Logging', active: false },
      { name: 'Mood Tracking', active: false },
    ],
    statsTitle: 'Health Overview',
    stats: [
      { value: '5.2h', label: 'Avg sleep (14d)' },
      { value: '8,420', label: 'Steps /day' },
      { value: '5', label: 'Day streak (water)' },
      { value: '27%', label: 'Below baseline' },
    ],
    unread: 2,
    timeline: [
      { date: 'Today', insights: [
        { category: 'Sleep', title: 'Sleep dropped below 6h three nights this week', detail: '14-day average: 5.2 hrs. Your baseline is 7.1 hrs.', mustSee: true },
        { category: 'Activity', title: 'Step count is up 12% since last month', detail: '8,420 avg daily steps vs. 7,520 last month.' },
      ]},
      { date: 'Mon, Mar 24', insights: [
        { category: 'Hydration', title: 'Water intake goal hit 5 days in a row', detail: 'Longest streak this month. Previous best was 3 days.', read: true },
      ]},
    ],
  },
  research: {
    since: 'March 12',
    lastAnalyzed: '3 hours ago',
    accounts: [{ name: 'Google Scholar' }, { name: 'ArXiv' }],
    goals: [
      { id: '1', text: 'Track AI agent adoption research' },
      { id: '2', text: 'Monitor competitors in my space' },
    ],
    skills: [
      { name: 'Topic Deep-dives', active: true },
      { name: 'Competitor Analysis', active: true },
      { name: 'Summarization', active: true },
      { name: 'Trend Spotting', active: true },
      { name: 'Source Verification', active: false },
    ],
    statsTitle: 'Research Activity',
    stats: [
      { value: '12', label: 'Pages in report' },
      { value: '5', label: 'Competitors analyzed' },
      { value: '3', label: 'New papers found' },
      { value: '1', label: 'Report ready' },
    ],
    unread: 2,
    timeline: [
      { date: 'Today', insights: [
        { category: 'Report', title: 'Competitive analysis ready — 12 pages', detail: '5 competitors analyzed: positioning, pricing, feature gaps.', mustSee: true },
      ]},
      { date: 'Fri, Mar 28', insights: [
        { category: 'Papers', title: '3 new papers on AI agent adoption', detail: 'Published in the last 14 days. Consumer trust, onboarding, retention.' },
      ]},
      { date: 'Tue, Mar 25', insights: [
        { category: 'Trend', title: 'Q1 2026 market trend summarized', detail: 'Enterprise adoption slowing, consumer interest accelerating.', read: true },
      ]},
    ],
  },
  'job-search': {
    since: 'March 20',
    lastAnalyzed: '30 minutes ago',
    accounts: [{ name: 'LinkedIn' }, { name: 'Indeed' }],
    goals: [
      { id: '1', text: 'Find a senior product role in AI/ML' },
      { id: '2', text: 'Target $180k+ base salary' },
      { id: '3', text: 'Prefer remote or hybrid in SF Bay Area' },
    ],
    skills: [
      { name: 'Job Matching', active: true },
      { name: 'Application Tracking', active: true },
      { name: 'Interview Prep', active: true },
      { name: 'Salary Benchmarking', active: true },
      { name: 'Network Alerts', active: false },
    ],
    statsTitle: 'Job Search',
    stats: [
      { value: '12', label: 'Roles matched' },
      { value: '4', label: 'Applications sent' },
      { value: '1', label: 'Interview stage' },
      { value: '$185k', label: 'Avg salary match' },
    ],
    unread: 3,
    timeline: [
      { date: 'Today', insights: [
        { category: 'New Roles', title: '3 new roles matching your profile', detail: 'Senior PM at Anthropic, Staff PM at OpenAI, Head of Product at Cohere. All remote-friendly.', mustSee: true },
        { category: 'Application', title: 'Stripe application moved to interview', detail: 'Your application for Senior PM was reviewed. Interview invite expected within 48 hours.', mustSee: true },
      ]},
      { date: 'Mon, Mar 31', insights: [
        { category: 'Salary', title: 'Salary benchmark updated for your target roles', detail: 'Senior PM in AI: $175k–$210k base. Your target of $180k sits at the 40th percentile.' },
      ]},
      { date: 'Fri, Mar 28', insights: [
        { category: 'Network', title: 'A former colleague just joined Anthropic', detail: 'Sarah Chen started as Director of Product last week. Could be a warm intro.', read: true },
      ]},
      { date: 'Wed, Mar 26', insights: [
        { category: 'Market', title: 'AI product roles up 23% this quarter', detail: 'Hiring in AI product management is accelerating. 340 new roles posted in the last 30 days.', read: true },
      ]},
    ],
  },
};

export default function AgentDetail({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const { getActivation, hydrated } = useActivatedAgents();
  const [configOpen, setConfigOpen] = useState(false);
  const [configTab, setConfigTab] = useState<'accounts' | 'instructions' | 'skills'>('accounts');
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [newGoal, setNewGoal] = useState('');

  const slug = name.toLowerCase();
  const agent = AGENTS.find((a) => agentSlug(a.name) === slug);
  const data = AGENT_DATA[slug];
  const IconComponent = agent ? ICON_MAP[agent.name] : undefined;
  const currentGoals = goals ?? data?.goals ?? [];

  if (!agent || !data) {
    return (
      <div className={styles.page}>
        <Header />
        <main className={styles.main}><p>Agent not found.</p></main>
      </div>
    );
  }

  const activeSkills = data.skills.filter((s) => s.active).length;

  const activation = getActivation(slug);
  const allInsights = data.timeline.flatMap((g) => g.insights);
  const unreadMustSee = allInsights
    .filter((i) => i.mustSee && !i.read)
    .map((i) => ({ title: i.title, detail: i.detail }));
  const totalUnread = allInsights.filter((i) => !i.read).length;
  const greeting = hydrated
    ? buildGreeting(activation, { unreadMustSee, totalUnread })
    : '';

  const addGoal = () => {
    if (!newGoal.trim()) return;
    setGoals([...currentGoals, { id: Date.now().toString(), text: newGoal.trim() }]);
    setNewGoal('');
  };

  const removeGoal = (id: string) => {
    setGoals(currentGoals.filter((g) => g.id !== id));
  };

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <Link href="/app" className={styles.back}>← Back</Link>

        {/* Agent header */}
        <div className={styles.agentHeader}>
          <div>
            <div className={styles.nameRow}>
              {IconComponent && <span className={styles.icon}><IconComponent /></span>}
              <h1 className={styles.agentName}>{agent.name}</h1>
            </div>
            <p className={styles.since}>Running since {data.since} — last analyzed {data.lastAnalyzed}</p>
          </div>
          <div className={styles.badges}>
            <button className={styles.headerBtn} onClick={() => setConfigOpen(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Configure
            </button>
            <button className={styles.headerBtn}>Stop agent</button>
            <span className={styles.activeBadge}><span className={styles.dot} />Active</span>
          </div>
        </div>

        {/* Greeting */}
        <p className={styles.greeting}>{greeting}</p>

        {/* Configure modal */}
        {configOpen && (
          <>
            <div className={styles.modalOverlay} onClick={() => setConfigOpen(false)} />
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Configure {agent.name}</h2>
                <button className={styles.modalClose} onClick={() => setConfigOpen(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className={styles.modalBody}>
                <nav className={styles.modalNav}>
                  {([
                    { key: 'accounts' as const, label: 'Accounts', count: data.accounts.length },
                    { key: 'instructions' as const, label: 'Instructions', count: currentGoals.length },
                    { key: 'skills' as const, label: 'Skills', count: `${activeSkills}/${data.skills.length}` },
                  ]).map((tab) => (
                    <button
                      key={tab.key}
                      className={`${styles.modalNavItem} ${configTab === tab.key ? styles.modalNavItemActive : ''}`}
                      onClick={() => setConfigTab(tab.key)}
                    >
                      {tab.label}
                      <span className={styles.modalNavCount}>{tab.count}</span>
                    </button>
                  ))}
                </nav>
                <div className={styles.modalContent}>
                  {configTab === 'accounts' && (
                    <div className={styles.configList}>
                      {data.accounts.map((a) => (
                        <div key={a.name} className={styles.configItem}>
                          <span>{a.name}</span>
                          <span className={styles.removeLink}>Remove</span>
                        </div>
                      ))}
                      <div className={styles.addItem}>+ Add account</div>
                    </div>
                  )}
                  {configTab === 'instructions' && (
                    <div className={styles.configList}>
                      {currentGoals.map((g) => (
                        <div key={g.id} className={styles.configItem}>
                          <span>{g.text}</span>
                          <button className={styles.removeLink} onClick={() => removeGoal(g.id)}>Remove</button>
                        </div>
                      ))}
                      <div className={styles.addGoalRow}>
                        <input
                          className={styles.addGoalInput}
                          placeholder="Add an instruction..."
                          value={newGoal}
                          onChange={(e) => setNewGoal(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addGoal()}
                        />
                        <button className={styles.addGoalBtn} onClick={addGoal}>Add</button>
                      </div>
                    </div>
                  )}
                  {configTab === 'skills' && (
                    <div className={styles.configList}>
                      {data.skills.map((skill) => (
                        <div key={skill.name} className={styles.configItem}>
                          <span className={skill.active ? '' : styles.skillInactive}>{skill.name}</span>
                          <div className={`${styles.toggle} ${skill.active ? styles.toggleOn : ''}`}>
                            <div className={styles.toggleDot} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Stats */}
        <div className={styles.statsSection}>
          <span className={styles.statsTitle}>{data.statsTitle}</span>
          <div className={styles.statsGrid}>
            {data.stats.map((s) => (
              <div key={s.label}>
                <span className={styles.statValue}>{s.value}</span>
                <span className={styles.statLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Insights */}
        {data.timeline.map((group) => (
          <div key={group.date} className={styles.timelineGroup}>
            <span className={`${styles.timelineDate} ${group.insights.some(i => !i.read) ? '' : styles.timelineDateRead}`}>
              {group.date}
            </span>
            <div className={styles.timelineCards}>
              {group.insights.map((insight) => (
                <div key={insight.title} className={`${styles.insightCard} ${insight.read ? styles.insightRead : ''}`}>
                  <div className={styles.insightTop}>
                    <span className={styles.insightCategory}>
                      {!insight.read && <span className={styles.insightDot} />}
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
        ))}
      </main>
      <ChatInput agent={agent.name} />
    </div>
  );
}
