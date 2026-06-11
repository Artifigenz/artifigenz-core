'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { DEFAULT_MODEL_ID } from '@artifigenz/shared';
import { HavenGreeting, HavenSuggestions } from '@/components/sections/HavenIntro';
import HavenAura from '@/components/effects/HavenAura';
import HavenTopBar from '@/components/sections/HavenTopBar';
import HavenComposer from '@/components/sections/HavenComposer';
import AgentGrid from '@/components/sections/AgentGrid';
import { useDevtools } from '@/lib/devtools-context';
import type { ChatAttachmentDraft, PasteSnippetDraft } from '@/components/sections/ChatInput';
import HomeChatMessages, { type ChatMessage } from '@/components/sections/HomeChatMessages';
import ChatHistoryModal from '@/components/sections/ChatHistoryModal';
import SettingsModal from '@/components/sections/SettingsModal';
import styles from './page.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Typewriter pacing — word-by-word reveal.
// Each tick advances the displayed text to the next whitespace boundary,
// but only after the per-word interval has elapsed. This gives the
// "deliberate typist" feel: words appear as whole units, fade in softly,
// and never crawl mid-word like a char-by-char reveal does.
const WORD_INTERVAL_MS = 130;       // ~7.7 wps — calm reading cadence
const WORD_INTERVAL_FAST_MS = 45;   // ~22 wps — used when far behind
const CATCHUP_WORDS_THRESHOLD = 60; // words buffered before speed-up

export default function AppHome() {
  const { getToken } = useAuth();
  const { agentMode } = useDevtools();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // Id of the assistant message currently revealing via the typewriter.
  // Cleared the instant the client-side buffer fully drains — used to gate
  // the footer toolbar + follow-up pills so they don't appear while text is
  // still being typed out.
  const [drainingId, setDrainingId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachmentDraft[]>([]);
  const [pasteSnippets, setPasteSnippets] = useState<PasteSnippetDraft[]>([]);
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);

  // Restore last selected model from localStorage on mount.
  useEffect(() => {
    const stored = localStorage.getItem('artifigenz.chat.model');
    if (stored) setModelId(stored);
  }, []);

  // ?settings=1 (e.g. via the /settings page redirect) auto-opens the modal.
  // We clear the param on close so the URL doesn't keep re-opening it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('settings') === '1') {
      setSettingsOpen(true);
    }
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('settings')) {
        url.searchParams.delete('settings');
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    }
  }, []);

  const changeModel = useCallback((id: string) => {
    setModelId(id);
    try {
      localStorage.setItem('artifigenz.chat.model', id);
    } catch {
      // localStorage can throw in some private-browsing modes; ignore.
    }
  }, []);

  const bufferRef = useRef<Map<string, { pending: string; displayed: string }>>(new Map());
  const rafRef = useRef<number | null>(null);
  const streamDoneRef = useRef<Set<string>>(new Set());
  const lastWordTimeRef = useRef<Map<string, number>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const inChat = messages.length > 0;

  const tick = useCallback((now: number) => {
    let dirty = false;
    let stillAnimating = false;

    const drained: string[] = [];
    bufferRef.current.forEach((entry, id) => {
      if (entry.displayed.length >= entry.pending.length) {
        if (streamDoneRef.current.has(id)) {
          bufferRef.current.delete(id);
          streamDoneRef.current.delete(id);
          lastWordTimeRef.current.delete(id);
          drained.push(id);
        }
        return;
      }

      // Count words still buffered to decide cadence.
      const ahead = entry.pending.slice(entry.displayed.length);
      const wordsAhead = ahead.split(/\s+/).filter(Boolean).length;
      const interval =
        wordsAhead > CATCHUP_WORDS_THRESHOLD
          ? WORD_INTERVAL_FAST_MS
          : WORD_INTERVAL_MS;

      const last = lastWordTimeRef.current.get(id) ?? 0;
      if (now - last < interval) {
        stillAnimating = true;
        return;
      }

      // Advance to the end of the next whitespace block (so the trailing
      // space comes in with the word — keeps wrapping natural).
      let i = entry.displayed.length;
      // skip any leading whitespace at the boundary
      while (i < entry.pending.length && /\s/.test(entry.pending[i])) i++;
      // consume the word
      while (i < entry.pending.length && !/\s/.test(entry.pending[i])) i++;
      // include trailing space(s) on the same line (but not a newline)
      while (
        i < entry.pending.length &&
        entry.pending[i] === ' '
      ) {
        i++;
      }
      // If a newline is next, include it too — paragraph breaks shouldn't
      // wait for an extra tick.
      if (i < entry.pending.length && entry.pending[i] === '\n') i++;

      if (i > entry.displayed.length) {
        entry.displayed = entry.pending.slice(0, i);
        lastWordTimeRef.current.set(id, now);
        dirty = true;
      }
      stillAnimating = true;
    });

    if (dirty) {
      const snap = new Map<string, string>();
      bufferRef.current.forEach((e, id) => snap.set(id, e.displayed));
      setMessages((prev) =>
        prev.map((m) => (snap.has(m.id) ? { ...m, content: snap.get(m.id)! } : m)),
      );
    }

    if (drained.length > 0) {
      setDrainingId((prev) => (prev !== null && drained.includes(prev) ? null : prev));
    }

    if (stillAnimating || bufferRef.current.size > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
    }
  }, []);

  const startTicker = useCallback(() => {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const addAttachmentFiles = useCallback(
    async (files: File[]) => {
      const token = await getToken();
      if (!token) return;
      for (const file of files) {
        const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const previewUrl = file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined;
        setAttachments((prev) => [
          ...prev,
          {
            fileId: tempId,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            previewUrl,
            status: 'uploading',
            createdAt: Date.now(),
          },
        ]);
        try {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch(`${API_URL}/api/me/chat/attachments`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error ?? `Upload failed (${res.status})`);
          }
          const data = (await res.json()) as {
            fileId: string;
            filename: string;
            mimeType: string;
            sizeBytes: number;
            extension: string;
          };
          setAttachments((prev) =>
            prev.map((a) =>
              a.fileId === tempId
                ? {
                    ...a,
                    fileId: data.fileId,
                    extension: data.extension,
                    status: 'ready',
                  }
                : a,
            ),
          );
        } catch (err) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.fileId === tempId
                ? {
                    ...a,
                    status: 'error',
                    error:
                      err instanceof Error ? err.message : 'Upload failed',
                  }
                : a,
            ),
          );
        }
      }
    },
    [getToken],
  );

  const addPasteSnippet = useCallback((text: string) => {
    const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const firstLine = text.split('\n', 1)[0]?.slice(0, 80) ?? '';
    setPasteSnippets((prev) => [
      ...prev,
      { id, content: text, firstLine, createdAt: Date.now() },
    ]);
  }, []);

  const removePasteSnippet = useCallback((id: string) => {
    setPasteSnippets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const removeAttachment = useCallback((fileId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.fileId === fileId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.fileId !== fileId);
    });
  }, []);

  /** Sends a message. If `truncateFromMessageId` is set, the server deletes
   *  that message and everything newer (used by edit + regenerate). */
  const runSend = useCallback(
    async (
      text: string,
      opts?: {
        truncateFromMessageId?: string;
        attachments?: ChatAttachmentDraft[];
        pasteSnippets?: PasteSnippetDraft[];
        model?: string;
        /** Regenerate the assistant turn — keep the existing user message. */
        regenerate?: boolean;
      },
    ) => {
      const hasAttachments = (opts?.attachments?.length ?? 0) > 0;
      const hasSnippets = (opts?.pasteSnippets?.length ?? 0) > 0;
      const isRegenerate = Boolean(opts?.regenerate);
      if (!isRegenerate && !text && !hasAttachments && !hasSnippets) return;

      const localUserId = `u-${Date.now()}`;
      const localAssistantId = `a-${Date.now()}`;
      const sendAtts = (opts?.attachments ?? []).filter(
        (a) => a.status === 'ready',
      );
      const sendSnippets = opts?.pasteSnippets ?? [];
      const userMsg: ChatMessage = {
        id: localUserId,
        role: 'user',
        content: text,
        attachments: sendAtts.map((a) => ({
          fileId: a.fileId,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
        pasteSnippets: sendSnippets.map((s) => ({
          id: s.id,
          content: s.content,
          firstLine: s.firstLine,
        })),
      };

      bufferRef.current.set(localAssistantId, { pending: '', displayed: '' });
      setDrainingId(localAssistantId);
      setMessages((prev) => {
        let truncated = prev;
        if (opts?.truncateFromMessageId) {
          const i = prev.findIndex(
            (m) => m.serverId === opts.truncateFromMessageId,
          );
          if (i >= 0) truncated = prev.slice(0, i);
        }
        return [
          ...truncated,
          // In regenerate mode the previous user message is preserved in the
          // truncated array — don't duplicate it.
          ...(isRegenerate ? [] : [userMsg]),
          {
            id: localAssistantId,
            role: 'assistant',
            content: '',
            modelId: opts?.model ?? modelId,
          },
        ];
      });
      setStreaming(true);
      setToolStatus(null);

      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');

        const controller = new AbortController();
        abortRef.current = controller;
        const res = await fetch(`${API_URL}/api/me/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: text,
            model: opts?.model ?? modelId,
            conversationId: conversationId || undefined,
            truncateFromMessageId: opts?.truncateFromMessageId,
            regenerate: isRegenerate,
            attachments: sendAtts.map((a) => ({
              fileId: a.fileId,
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              extension: a.extension,
            })),
            pasteSnippets: sendSnippets.map((s) => ({
              id: s.id,
              content: s.content,
              firstLine: s.firstLine,
            })),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Chat failed' }));
          throw new Error((err as { error?: string }).error ?? `Error ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response stream');
        const decoder = new TextDecoder();
        let buf = '';
        // SSE: each event is a `event: <type>\ndata: <json>\n\n` block.
        // We track the current event type as we walk lines.
        let currentEvent = '';

        const processLine = (line: string) => {
          if (line === '') {
            currentEvent = '';
            return;
          }
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            return;
          }
          if (!line.startsWith('data: ')) return;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            return;
          }
          console.log(
            `[chat] SSE ${currentEvent}:`,
            JSON.stringify(data).slice(0, 200),
          );

          switch (currentEvent) {
              case 'conversation':
                if (typeof data.conversationId === 'string') {
                  setConversationId(data.conversationId);
                }
                if (typeof data.title === 'string') {
                  setConversationTitle(data.title);
                }
                break;
              case 'user_message':
                if (typeof data.messageId === 'string') {
                  const serverId = data.messageId;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === localUserId ? { ...m, serverId } : m,
                    ),
                  );
                }
                break;
              case 'delta':
                if (typeof data.content === 'string') {
                  const entry = bufferRef.current.get(localAssistantId);
                  if (entry) entry.pending += data.content;
                  startTicker();
                }
                break;
              case 'tool_use': {
                const toolName = String(data.tool ?? '');
                const label =
                  toolName === 'web_search'
                    ? 'Searching the web'
                    : toolName
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^get\s/i, 'Looking up ')
                        .trim();
                setToolStatus(`${label}...`);
                break;
              }
              case 'tool_result':
                setToolStatus(null);
                break;
              case 'citations':
                if (Array.isArray(data.citations)) {
                  const citations = data.citations as Array<{
                    url: string;
                    title: string;
                    citedText?: string;
                  }>;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === localAssistantId ? { ...m, citations } : m,
                    ),
                  );
                }
                break;
              case 'followups':
                if (Array.isArray(data.followUps)) {
                  const followUps = data.followUps as string[];
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === localAssistantId ? { ...m, followUps } : m,
                    ),
                  );
                }
                break;
              case 'done':
                if (typeof data.messageId === 'string') {
                  const serverId = data.messageId;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === localAssistantId ? { ...m, serverId } : m,
                    ),
                  );
                }
                setToolStatus(null);
                break;
              case 'error':
                bufferRef.current.delete(localAssistantId);
                lastWordTimeRef.current.delete(localAssistantId);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === localAssistantId
                      ? { ...m, content: `Error: ${data.message ?? 'Unknown error'}` }
                      : m,
                  ),
                );
                break;
            }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Server may close before flushing the trailing newline, leaving
            // the last `data:` line stuck in buf. Process it before bailing.
            if (buf.length > 0) {
              processLine(buf);
              buf = '';
            }
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) processLine(line);
        }

        streamDoneRef.current.add(localAssistantId);
        startTicker();
        // Network is done. Unlock the input + past regenerate buttons even
        // if the typewriter is still draining — the buffer will continue to
        // reveal text in parallel.
        setStreaming(false);
      } catch (err) {
        const isAbort =
          err instanceof DOMException && err.name === 'AbortError';
        if (isAbort) {
          // User clicked stop — flush whatever's already in the buffer so it
          // stays visible, then let the ticker drain. Network is over, so
          // unlock the input immediately.
          const entry = bufferRef.current.get(localAssistantId);
          if (entry) entry.displayed = entry.pending;
          streamDoneRef.current.add(localAssistantId);
          startTicker();
          setStreaming(false);
        } else {
          bufferRef.current.delete(localAssistantId);
          streamDoneRef.current.delete(localAssistantId);
          lastWordTimeRef.current.delete(localAssistantId);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === localAssistantId
                ? {
                    ...m,
                    content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
                  }
                : m,
            ),
          );
          setStreaming(false);
          setDrainingId((prev) => (prev === localAssistantId ? null : prev));
        }
        setToolStatus(null);
      } finally {
        abortRef.current = null;
        setToolStatus(null);
      }
    },
    [conversationId, getToken, startTicker, modelId],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    const ready = attachments.filter((a) => a.status === 'ready');
    if (!text && ready.length === 0 && pasteSnippets.length === 0) return;
    setInput('');
    setAttachments([]);
    const snapshotSnippets = pasteSnippets;
    setPasteSnippets([]);
    await runSend(text, {
      attachments: ready,
      pasteSnippets: snapshotSnippets,
    });
  }, [input, attachments, pasteSnippets, runSend]);

  const stopGenerating = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    bufferRef.current.clear();
    streamDoneRef.current.clear();
    setDrainingId(null);
    lastWordTimeRef.current.clear();
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setMessages([]);
    setInput('');
    setConversationId(null);
    setConversationTitle(null);
    setStreaming(false);
    setToolStatus(null);
  }, []);

  const loadConversation = useCallback(
    async (id: string) => {
      // Abort whatever's in flight, then fetch the conversation's messages.
      abortRef.current?.abort();
      bufferRef.current.clear();
      streamDoneRef.current.clear();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setStreaming(false);
      setDrainingId(null);
      setToolStatus(null);

      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(`${API_URL}/api/me/conversations/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        const data = (await res.json()) as {
          conversation: { id: string; title?: string };
          messages: Array<{
            id: string;
            role: 'user' | 'assistant';
            content: string;
            metadata?: {
              citations?: ChatMessage['citations'];
              attachments?: ChatMessage['attachments'];
              pasteSnippets?: ChatMessage['pasteSnippets'];
              followUps?: ChatMessage['followUps'];
              modelId?: string;
            } | null;
          }>;
        };
        setConversationId(data.conversation.id);
        setConversationTitle(data.conversation.title ?? null);
        setMessages(
          data.messages.map((m) => ({
            id: `${m.role[0]}-${m.id}`,
            serverId: m.id,
            role: m.role,
            content: m.content,
            citations: m.metadata?.citations,
            attachments: m.metadata?.attachments,
            pasteSnippets: m.metadata?.pasteSnippets,
            followUps: m.metadata?.followUps,
            modelId: m.metadata?.modelId,
          })),
        );
        // Scroll to bottom on next paint
        requestAnimationFrame(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight });
        });
      } catch (err) {
        console.error('[chat] load failed', err);
      }
    },
    [getToken],
  );

  const onEditSubmit = useCallback(
    async (messageId: string, newText: string) => {
      const target = messages.find((m) => m.id === messageId);
      if (!target?.serverId) return;
      await runSend(newText, { truncateFromMessageId: target.serverId });
    },
    [messages, runSend],
  );

  const onRegenerate = useCallback(
    async (assistantMessageId: string, overrideModelId?: string) => {
      const idx = messages.findIndex((m) => m.id === assistantMessageId);
      if (idx <= 0) return;
      const prevUser = messages[idx - 1];
      const assistant = messages[idx];
      if (prevUser?.role !== 'user' || !assistant.serverId) return;
      // If user retried with a different model, also flip the picker so the
      // next manual send keeps that model — matches ChatGPT's behavior.
      if (overrideModelId && overrideModelId !== modelId) {
        changeModel(overrideModelId);
      }
      await runSend(prevUser.content, {
        truncateFromMessageId: assistant.serverId,
        model: overrideModelId,
        regenerate: true,
      });
    },
    [messages, runSend, modelId, changeModel],
  );

  return (
    <div className={styles.page}>
      <HavenAura />
      <HavenTopBar
        onHistory={() => setHistoryOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        title={inChat ? conversationTitle : null}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        modelId={modelId}
        onModelChange={changeModel}
      />
      <ChatHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={loadConversation}
        currentConversationId={conversationId}
        onCurrentDeleted={newChat}
      />
      <main
        className={`${styles.main} ${inChat ? styles.mainInChat : styles.mainIntro}`}
      >
        {!inChat && (
          <div className={styles.havenStage}>
            <HavenGreeting />
            <div className={styles.composerSlot}>
              <HavenComposer
                value={input}
                onChange={setInput}
                onSend={sendMessage}
                modelId={modelId}
                onModelChange={changeModel}
                onAddFiles={addAttachmentFiles}
                homeStage
              />
            </div>
            <HavenSuggestions onPick={(text) => runSend(text)} />
            {agentMode && <AgentGrid />}
          </div>
        )}
        {inChat && (
          <>
            <HomeChatMessages
              messages={messages}
              streaming={streaming}
              drainingId={drainingId}
              toolStatus={toolStatus}
              onEdit={onEditSubmit}
              onRegenerate={onRegenerate}
              onFollowUp={(text) => runSend(text)}
            />
            <div className={styles.fadeBottom} aria-hidden="true" />
            <div className={styles.composerDock}>
              <HavenComposer
                value={input}
                onChange={setInput}
                onSend={sendMessage}
                modelId={modelId}
                onModelChange={changeModel}
                onAddFiles={addAttachmentFiles}
                disabled={streaming}
              />
            </div>
          </>
        )}
      </main>
      {!inChat && <div className={styles.tagline}>ai chat. on steroids.</div>}
    </div>
  );
}
