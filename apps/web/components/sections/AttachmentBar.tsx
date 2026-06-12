'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatAttachmentDraft, PasteSnippetDraft } from './ChatInput';
import styles from './AttachmentBar.module.css';

/**
 * AttachmentBar — combined paste-snippet + file-attachment chip row.
 *
 * Ported verbatim from the original ChatInput implementation so the
 * Haven composer keeps the same behaviour: merge both lists in insertion
 * order, measure how many chips fit, collapse the rest into a +N pill
 * that opens a flyout. Resizes via ResizeObserver. Click-outside closes
 * the flyout.
 */

type Item =
  | { kind: 'snippet'; data: PasteSnippetDraft }
  | { kind: 'file'; data: ChatAttachmentDraft };

interface AttachmentBarProps {
  snippets: PasteSnippetDraft[];
  attachments: ChatAttachmentDraft[];
  onRemoveSnippet?: (id: string) => void;
  onRemoveAttachment?: (fileId: string) => void;
}

export default function AttachmentBar({
  snippets,
  attachments,
  onRemoveSnippet,
  onRemoveAttachment,
}: AttachmentBarProps) {
  const items: Item[] = [
    ...attachments.map((a): Item => ({ kind: 'file', data: a })),
    ...snippets.map((s): Item => ({ kind: 'snippet', data: s })),
  ].sort((a, b) => {
    const ta = a.kind === 'file' ? a.data.createdAt : a.data.createdAt;
    const tb = b.kind === 'file' ? b.data.createdAt : b.data.createdAt;
    return ta - tb;
  });
  const barRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowWrapRef = useRef<HTMLDivElement>(null);

  // Recompute how many chips fit in one row. Measures against the BAR's
  // outer width (not the row's, which is clipped) so the math is stable
  // whether or not the +N pill is currently rendered.
  useEffect(() => {
    if (items.length === 0) return;
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return;

    const compute = () => {
      const containerWidth = bar.clientWidth;
      if (containerWidth === 0) return;
      // Reserve room for the +N pill (≈ 44px chip + 8 gap).
      const reservedForOverflow = 56;
      const children = Array.from(measure.children) as HTMLElement[];
      let used = 0;
      let fits = 0;
      for (let i = 0; i < children.length; i++) {
        const w = children[i].offsetWidth + 8; // 8 = gap
        const isLast = i === children.length - 1;
        const cap = isLast
          ? containerWidth
          : containerWidth - reservedForOverflow;
        if (used + w > cap) break;
        used += w;
        fits++;
      }
      setVisibleCount(Math.max(fits, 0));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [items.length, snippets, attachments]);

  // Click-outside close for the overflow flyout
  useEffect(() => {
    if (!overflowOpen) return;
    const handle = (e: MouseEvent) => {
      if (
        overflowWrapRef.current &&
        !overflowWrapRef.current.contains(e.target as Node)
      ) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [overflowOpen]);

  if (items.length === 0) return null;

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);

  return (
    <div ref={barRef} className={styles.attachmentBar}>
      <div className={styles.attachmentBarFlex}>
        <div ref={rowRef} className={styles.attachmentsRow}>
          {visible.map((item) => (
            <AttachmentChip
              key={chipKey(item)}
              item={item}
              onRemoveSnippet={onRemoveSnippet}
              onRemoveAttachment={onRemoveAttachment}
            />
          ))}
        </div>
        {overflow.length > 0 && (
          <div className={styles.overflowWrap} ref={overflowWrapRef}>
            <button
              type="button"
              className={styles.overflowChip}
              onClick={() => setOverflowOpen((v) => !v)}
              aria-label={`${overflow.length} more attachment${overflow.length === 1 ? '' : 's'}`}
            >
              +{overflow.length}
            </button>
            {overflowOpen && (
              <div className={styles.overflowFlyout}>
                {overflow.map((item) => (
                  <AttachmentChip
                    key={chipKey(item)}
                    item={item}
                    onRemoveSnippet={onRemoveSnippet}
                    onRemoveAttachment={onRemoveAttachment}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Hidden measurement row — all items at natural width */}
      <div ref={measureRef} className={styles.attachmentsMeasure} aria-hidden>
        {items.map((item) => (
          <AttachmentChip
            key={chipKey(item)}
            item={item}
            onRemoveSnippet={onRemoveSnippet}
            onRemoveAttachment={onRemoveAttachment}
          />
        ))}
      </div>
    </div>
  );
}

function chipKey(item: Item): string {
  return item.kind === 'snippet'
    ? `s-${item.data.id}`
    : `f-${item.data.fileId}`;
}

function formatChars(n: number): string {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
}

function AttachmentChip({
  item,
  onRemoveSnippet,
  onRemoveAttachment,
}: {
  item: Item;
  onRemoveSnippet?: (id: string) => void;
  onRemoveAttachment?: (fileId: string) => void;
}) {
  if (item.kind === 'snippet') {
    const s = item.data;
    return (
      <div className={styles.attachmentChip}>
        <span className={styles.attachmentIcon} aria-hidden>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="15" y2="17" />
          </svg>
        </span>
        <span
          className={styles.attachmentName}
          title={s.firstLine ?? `${s.content.length} chars`}
        >
          Pasted text · {formatChars(s.content.length)}
        </span>
        <button
          type="button"
          className={styles.attachmentRemove}
          aria-label="Remove pasted text"
          onClick={() => onRemoveSnippet?.(s.id)}
        >
          ×
        </button>
      </div>
    );
  }

  const a = item.data;
  return (
    <div className={styles.attachmentChip}>
      {a.previewUrl && a.mimeType.startsWith('image/') ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a.previewUrl}
          alt={a.filename}
          className={styles.attachmentThumb}
        />
      ) : (
        <span className={styles.attachmentIcon} aria-hidden>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </span>
      )}
      <span className={styles.attachmentName} title={a.filename}>
        {a.filename}
      </span>
      {a.status === 'uploading' && (
        <span className={styles.attachmentStatus}>uploading…</span>
      )}
      {a.status === 'error' && (
        <span className={styles.attachmentStatusError}>
          {a.error ?? 'failed'}
        </span>
      )}
      <button
        type="button"
        className={styles.attachmentRemove}
        aria-label="Remove attachment"
        onClick={() => onRemoveAttachment?.(a.fileId)}
      >
        ×
      </button>
    </div>
  );
}
