'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import LandingHeader from './LandingHeader';
import Slide1Hero from './slides/Slide1Hero';
import Slide2HowItWorks from './slides/Slide2HowItWorks';
import Slide3Consultants from './slides/Slide3Consultants';
import Slide4Testimonials from './slides/Slide4Testimonials';
import Slide5Closing from './slides/Slide5Closing';
import styles from './LandingSlider.module.css';

const TOTAL_SLIDES = 5;
const SLIDE_LABELS = ['Hero', 'How it works', 'Consultants', 'Testimonials', 'Always on'];

export default function LandingSlider() {
  const [current, setCurrent] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // ── Detect reduced-motion preference ─────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Track current slide via scroll position ──────────────
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    let rafId = 0;
    const onScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const newIndex = Math.round(el.scrollTop / el.clientHeight);
        setCurrent((prev) => (prev !== newIndex ? newIndex : prev));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // ── Programmatic scroll to a slide ───────────────────────
  const scrollToIndex = useCallback((index: number) => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(index, TOTAL_SLIDES - 1));
    el.scrollTo({ top: target * el.clientHeight, behavior: 'smooth' });
  }, []);

  const goNext = useCallback(() => {
    scrollToIndex(current + 1);
  }, [current, scrollToIndex]);

  const goPrev = useCallback(() => {
    scrollToIndex(current - 1);
  }, [current, scrollToIndex]);

  const goTo = useCallback(
    (index: number) => {
      scrollToIndex(index);
    },
    [scrollToIndex]
  );

  // ── Keyboard navigation ──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        goPrev();
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        goTo(parseInt(e.key, 10) - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        goTo(TOTAL_SLIDES - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, goTo]);

  // Auto-advance is driven by the progress ring's CSS animation.
  // When it completes, this fires and we move to the next slide.
  const onProgressEnd = () => {
    if (current < TOTAL_SLIDES - 1) {
      scrollToIndex(current + 1);
    }
  };

  const isFirst = current === 0;
  const isLast = current === TOTAL_SLIDES - 1;
  const showProgress = !reducedMotion && !isLast;

  return (
    <div className={styles.slider}>
      <LandingHeader />

      <div ref={scrollAreaRef} className={styles.scrollArea}>
        <Slide1Hero isActive={current === 0} index={0} currentIndex={current} />
        <Slide2HowItWorks isActive={current === 1} index={1} currentIndex={current} />
        <Slide3Consultants isActive={current === 2} index={2} currentIndex={current} />
        <Slide4Testimonials isActive={current === 3} index={3} currentIndex={current} />
        <Slide5Closing isActive={current === 4} index={4} currentIndex={current} />
      </div>

      {/* ── Left edge: minimal vertical dot indicators ── */}
      <div className={styles.leftIndicators} role="tablist" aria-label="Landing slides">
        {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={current === i}
            aria-label={`Slide ${i + 1}: ${SLIDE_LABELS[i]}`}
            className={`${styles.dot} ${current === i ? styles.dotActive : ''}`}
            onClick={() => goTo(i)}
          />
        ))}
      </div>

      {/* ── Right edge: vertical arrow controls + progress ring ── */}
      <div className={styles.rightControls}>
        <button
          type="button"
          className={styles.arrowBtn}
          onClick={goPrev}
          disabled={isFirst}
          aria-label="Previous slide"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>

        <div className={styles.nextWrap}>
          {showProgress && (
            <svg className={styles.progressRing} viewBox="0 0 50 50" aria-hidden="true">
              <circle
                cx="25"
                cy="25"
                r="23"
                className={styles.progressTrack}
              />
              <circle
                key={current}
                cx="25"
                cy="25"
                r="23"
                className={styles.progressBar}
                onAnimationEnd={onProgressEnd}
              />
            </svg>
          )}
          <button
            type="button"
            className={styles.arrowBtn}
            onClick={goNext}
            disabled={isLast}
            aria-label="Next slide"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
