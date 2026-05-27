// Strip markdown syntax so the TTS doesn't read out asterisks, backticks,
// pipe characters, etc. Replaces fenced code blocks with a short spoken
// placeholder so the listener knows code was skipped.

export function markdownToSpeech(md: string): string {
  let s = md;

  // Fenced code blocks → spoken placeholder
  s = s.replace(/```[\s\S]*?```/g, ' (code block) ');

  // Inline code: keep contents, drop backticks
  s = s.replace(/`([^`]+)`/g, '$1');

  // Images: keep alt text, drop syntax
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Links: keep label, drop URL
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  // Headings: strip leading #'s, keep text
  s = s.replace(/^#{1,6}\s+/gm, '');

  // Blockquotes: strip leading '>'
  s = s.replace(/^>\s?/gm, '');

  // Horizontal rules
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, '');

  // List bullets (-, *, +) at line start
  s = s.replace(/^\s*[-*+]\s+/gm, '');

  // Ordered list markers "1. "
  s = s.replace(/^\s*\d+\.\s+/gm, '');

  // Bold / italic markers
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2');

  // Strikethrough
  s = s.replace(/~~([^~]+)~~/g, '$1');

  // Tables: drop separator lines like |---|---|
  s = s.replace(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/gm, '');
  // Tables: drop leading/trailing pipes, replace internal pipes with commas
  s = s.replace(/^\s*\|/gm, '').replace(/\|\s*$/gm, '');
  s = s.replace(/\s*\|\s*/g, ', ');

  // Collapse 3+ newlines to 2 (paragraph break) and trim
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  return s;
}
