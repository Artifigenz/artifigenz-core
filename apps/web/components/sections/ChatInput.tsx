'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { AGENTS } from '@artifigenz/shared';
import styles from './ChatInput.module.css';

const activeAgents = AGENTS.filter((a) => a.active);

interface ChatInputProps {
  agent?: string;
}

export default function ChatInput({ agent }: ChatInputProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentFlyout, setAgentFlyout] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setAgentFlyout(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Agent-scoped mode
  if (agent) {
    return (
      <div className={styles.bar}>
        <div className={styles.inner}>
          <div className={styles.compactBox}>
            <div className={styles.addWrap} ref={menuRef}>
              <button
                className={styles.addBtn}
                aria-label="Add"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {menuOpen && (
                <div className={styles.menu}>
                  <button className={styles.menuItem} onClick={() => setMenuOpen(false)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span>Add files or images</span>
                  </button>
                </div>
              )}
            </div>
            <input
              type="text"
              className={styles.compactInput}
              placeholder={`Ask ${agent}...`}
            />
            <button className={styles.compactSend} aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Full mode (homepage)
  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <div className={styles.box}>
          <textarea
            className={styles.input}
            placeholder={selectedAgent ? `Ask ${selectedAgent}...` : 'Ask anything or give a task...'}
            rows={1}
          />
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
            <div className={styles.addWrap} ref={menuRef}>
              <button
                className={styles.addBtn}
                aria-label="Add"
                onClick={() => { setMenuOpen(!menuOpen); setAgentFlyout(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {menuOpen && (
                <div className={styles.menu}>
                  <button className={styles.menuItem} onClick={() => setMenuOpen(false)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span>Add files or images</span>
                  </button>
                  <div className={styles.menuItemWrap}>
                    <button className={styles.menuItem} onClick={() => setAgentFlyout(!agentFlyout)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span>Agents</span>
                      <svg className={styles.chevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    {agentFlyout && (
                      <div className={styles.flyout}>
                        {activeAgents.map((a) => (
                          <button
                            key={a.name}
                            className={styles.flyoutItem}
                            onClick={() => { setSelectedAgent(a.name); setMenuOpen(false); setAgentFlyout(false); }}
                          >
                            <span className={styles.flyoutDot} />
                            {a.name}
                          </button>
                        ))}
                        <div className={styles.flyoutDivider} />
                        <Link
                          href="/explore"
                          className={styles.flyoutExplore}
                          onClick={() => { setMenuOpen(false); setAgentFlyout(false); }}
                        >
                          Add agents →
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {selectedAgent && (
              <span className={styles.selectedChip}>
                <span className={styles.flyoutDot} />
                {selectedAgent}
                <button
                  className={styles.selectedRemove}
                  onClick={() => setSelectedAgent(null)}
                  aria-label="Remove agent"
                >
                  ×
                </button>
              </span>
            )}
            </div>
            <button className={styles.sendBtn} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
