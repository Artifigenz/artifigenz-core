'use client';

import Link from 'next/link';
import Image from 'next/image';
import * as Icons from '@/components/sections/AgentIcons';
import Slide, { type SlideProps } from './Slide';
import sharedStyles from './Slide.module.css';
import styles from './Slide1Hero.module.css';

interface AgentRow {
  name: string;
  IconComponent: React.ComponentType;
  time: string;
  insight: string;
  insightMobile: string;
}

const AGENT_ROWS: AgentRow[] = [
  {
    name: 'Finance',
    IconComponent: Icons.FinanceIcon,
    time: '2 min ago',
    insight: 'You spent 22% more on dining out this month compared to last.',
    insightMobile: '3 subscriptions haven\u2019t been used in 60+ days.',
  },
  {
    name: 'Travel',
    IconComponent: Icons.TravelIcon,
    time: '18 min ago',
    insight: 'Your usual hotel in Bali just opened March availability.',
    insightMobile: 'Flights to Tokyo dropped 34% for April 12\u201319.',
  },
  {
    name: 'Health',
    IconComponent: Icons.HealthIcon,
    time: '1 hr ago',
    insight: 'Sleep dropped below 6h three nights this week.',
    insightMobile: 'Sleep dropped below 6h three nights this week.',
  },
  {
    name: 'Research',
    IconComponent: Icons.ResearchIcon,
    time: '3 hr ago',
    insight: 'Competitive analysis on 5 players in your space is ready.',
    insightMobile: 'Competitive analysis on 5 players in your space i\u2026',
  },
  {
    name: 'Job Search',
    IconComponent: Icons.JobSearchIcon,
    time: '30 min ago',
    insight: '3 new roles matching your profile posted today.',
    insightMobile: '3 new roles matching your profile posted today.',
  },
];

function HouseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function Slide1Hero(props: SlideProps) {
  return (
    <Slide {...props} className={styles.slide1}>
      <div className={`${sharedStyles.inner} ${styles.inner}`}>
        {/* ── Top: centered text ── */}
        <div className={styles.text}>
          <p className={sharedStyles.eyebrow}>
            <span className={sharedStyles.eyebrowDot} />
            AI consultants, not AI tools
          </p>
          <h1 className={`${sharedStyles.title} ${styles.title}`}>
            Stop instructing AI.<br />
            Start approving it.
          </h1>
          <p className={`${sharedStyles.subtitle} ${styles.subtitle}`}>
            A team of consultants who watch your world, find the things you&rsquo;d miss,
            and bring you proposals. You just approve.
          </p>
          <Link href="/sign-up" className={sharedStyles.cta}>
            Get started
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* ── Below: dashboard mockup ── */}
        <div className={styles.devices} aria-hidden="true">
          <div className={styles.glow} />

          {/* ─── Desktop dashboard ─── */}
          <div className={styles.desktop}>
            {/* Header */}
            <div className={styles.dHeader}>
              <div className={styles.dBrand}>
                <Image
                  src="/logo_transparent.png"
                  alt=""
                  width={20}
                  height={20}
                  className={styles.dBrandIcon}
                />
                <span className={styles.dBrandText}>Artifigenz</span>
              </div>
              <nav className={styles.dNav}>
                <span className={`${styles.dNavLink} ${styles.dNavLinkActive}`}>
                  <HouseIcon /> Home
                </span>
                <span className={styles.dNavLink}>
                  <CompassIcon /> Explore
                </span>
              </nav>
              <div className={styles.dProfile}>
                <span className={styles.dAvatar}>C</span>
                <span className={styles.dProfileName}>Cooper</span>
              </div>
            </div>

            {/* Body */}
            <div className={styles.dBody}>
              <h3 className={styles.dGreeting}>
                Good afternoon, Cooper — your 5 agents are just getting started.
              </h3>

              <div className={styles.dAgentList}>
                {AGENT_ROWS.map((row) => (
                  <div key={row.name} className={styles.dAgentRow}>
                    <div className={styles.dAgentIcon}>
                      <row.IconComponent />
                    </div>
                    <div className={styles.dAgentBody}>
                      <div className={styles.dAgentMeta}>
                        <span className={styles.dAgentName}>{row.name}</span>
                        <span className={styles.metaDot} />
                        <span className={styles.dAgentTime}>{row.time}</span>
                      </div>
                      <p className={styles.dAgentInsight}>{row.insight}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.dAddAgent}>+ Add an agent</div>

              {/* Chat input */}
              <div className={styles.dChatBar}>
                <span className={styles.dChatPlaceholder}>Ask anything or give a task...</span>
                <div className={styles.dChatToolbar}>
                  <span className={styles.dChatPlus}>
                    <PlusIcon />
                  </span>
                  <span className={styles.dChatSend}>
                    <SendIcon />
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Mobile dashboard overlay ─── */}
          <div className={styles.mobile}>
            {/* Header */}
            <div className={styles.mHeader}>
              <div className={styles.mBrand}>
                <Image
                  src="/logo_transparent.png"
                  alt=""
                  width={14}
                  height={14}
                  className={styles.mBrandIcon}
                />
                <span className={styles.mBrandText}>Artifigenz</span>
              </div>
              <span className={styles.mHamburger}>
                <HamburgerIcon />
              </span>
            </div>

            {/* Body */}
            <div className={styles.mBody}>
              <h4 className={styles.mGreeting}>
                Good afternoon, Cooper — your 5 agents are just getting started.
              </h4>

              <div className={styles.mAgentList}>
                {AGENT_ROWS.map((row) => (
                  <div key={row.name} className={styles.mAgentRow}>
                    <div className={styles.mAgentIcon}>
                      <row.IconComponent />
                    </div>
                    <div className={styles.mAgentBody}>
                      <div className={styles.mAgentMeta}>
                        <span className={styles.mAgentName}>{row.name}</span>
                        <span className={styles.metaDot} />
                        <span className={styles.mAgentTime}>{row.time}</span>
                      </div>
                      <p className={styles.mAgentInsight}>{row.insightMobile}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.mAddAgent}>+ Add an agent</div>
            </div>

            {/* Chat input */}
            <div className={styles.mChatBar}>
              <span className={styles.mChatPlaceholder}>Ask anything or give a task...</span>
              <div className={styles.mChatToolbar}>
                <span className={styles.mChatPlus}>
                  <PlusIcon />
                </span>
                <span className={styles.mChatSend}>
                  <SendIcon />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Slide>
  );
}
